import VCFDataFetcher from './sv-fetcher';
import VariantAligner from './sv-align';
import { spawn, Worker } from 'threads';
import { PILEUP_COLORS, SV_TYPE, vcfRecordToJson } from './sv-utils';
import { TabixIndexedFile } from '@gmod/tabix';
import VCF from '@gmod/vcf';
import { RemoteFile } from 'generic-filehandle';
import { ChromosomeInfo, absToChr } from './chrominfo-utils';

const createColorTexture = (PIXI, colors) => {
  const colorTexRes = Math.max(2, Math.ceil(Math.sqrt(colors.length)));
  const rgba = new Float32Array(colorTexRes ** 2 * 4);
  colors.forEach((color, i) => {
    // eslint-disable-next-line prefer-destructuring
    rgba[i * 4] = color[0]; // r
    // eslint-disable-next-line prefer-destructuring
    rgba[i * 4 + 1] = color[1]; // g
    // eslint-disable-next-line prefer-destructuring
    rgba[i * 4 + 2] = color[2]; // b
    // eslint-disable-next-line prefer-destructuring
    rgba[i * 4 + 3] = color[3]; // a
  });

  return [PIXI.Texture.fromBuffer(rgba, colorTexRes, colorTexRes), colorTexRes];
};

function invY(p, t) {
  return (p - t.y) / t.k;
}

/**
 * Get the location of this script so that we can use it to fetch
 * the worker script.
 *
 * @return {String}         The url of this script
 */
function getThisScriptLocation() {
  const scripts = [...document.getElementsByTagName('script')];
  for (const script of scripts) {
    const parts = script.src.split('/');

    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];

      if (lastPart.indexOf('higlass-sv') >= 0) {
        return parts.slice(0, parts.length - 1).join('/');
      }
    }
  }
}

const scaleScalableGraphics = (graphics, xScale, drawnAtScale) => {
  const tileK =
    (drawnAtScale.domain()[1] - drawnAtScale.domain()[0]) /
    (xScale.domain()[1] - xScale.domain()[0]);
  const newRange = xScale.domain().map(drawnAtScale);

  const posOffset = newRange[0];
  graphics.scale.x = tileK;
  graphics.position.x = -posOffset * tileK;
};


function eqSet(as, bs) {
  return as.size === bs.size && all(isIn(bs), as);
}

function all(pred, as) {
  for (var a of as) if (!pred(a)) return false;
  return true;
}

function isIn(as) {
  return function (a) {
    return as.has(a);
  };
}


const SvTrack = (HGC, ...args) => {
  if (!new.target) {
    throw new Error(
      'Uncaught TypeError: Class constructor cannot be invoked without "new"',
    );
  }

  class SvTrackClass extends HGC.tracks.Tiled1DPixiTrack {
    constructor(context, options) {
      let baseUrl = `${getThisScriptLocation()}/`;
      if (options.workerScriptLocation) {
        baseUrl = options.workerScriptLocation;
      }

      const worker = spawn(
        new Worker('./sv-fetcher-worker.js', {
          _baseURL: baseUrl,
        }),
      );

      // this is where the threaded tile fetcher is called
      context.dataFetcher = new VCFDataFetcher(context.dataConfig, worker, HGC);
      super(context, options);
      context.dataFetcher.track = this;

      // Install BitmapFont, used by BitmapText later
      HGC.libraries.PIXI.BitmapFont.from("SVLabel", {
        fontFamily: "Arial",
        fontSize: 23,
        fontWeight: 500,
        strokeThickness: 0,
        fill: "#333333"
      },{ chars: HGC.libraries.PIXI.BitmapFont.ASCII });

      HGC.libraries.PIXI.BitmapFont.from("FilterLabel", {
        fontFamily: "Arial",
        fontSize: 23,
        fontWeight: 500,
        strokeThickness: 0,
        fill: "#ffffff"
      },{ chars: HGC.libraries.PIXI.BitmapFont.ASCII });

      const chromInfoDataPromise = this.getChromInfoDataPromise(context.dataConfig.chromSizesUrl)
      // const chromInfoDataPromise = this.getChromInfoDataPromise(context.dataConfig.chromSizesUrl).then((value) => {
      //   this.chromInfo = value;
      // });
      this.variantAligner = new VariantAligner();
      
      this.svData = [];
      this.visibleChromosomes = [];
      this.svDataPerChromosome = {};
      this.svTexts = {};
      this.svTextWidths = {};
      this.svTextHeights = {};
      this.numFilteredVariants = 0;
      this.numVisibleVariants = 0;

      this.textGraphics = new HGC.libraries.PIXI.Graphics();
      this.pForeground.addChild(this.textGraphics);

      this.labelGraphics = new HGC.libraries.PIXI.Graphics();
      this.pForeground.addChild(this.labelGraphics);
      
      // this.dataPromises = this.getSvDataPromises(context.dataConfig);
      
      

      this.vcfFile = new TabixIndexedFile({
        filehandle: new RemoteFile(context.dataConfig.vcfUrl),
        tbiFilehandle: new RemoteFile(context.dataConfig.tbiUrl),
      });
      const vcfHeader = this.vcfFile.getHeader();
      // const vcfHeader = this.vcfFile.getHeader().then((value) => {
      //   this.vcfHeader = value;
      // });

      Promise.all([chromInfoDataPromise, vcfHeader]).then((values) => {
        this.chromInfo = values[0];
        this.vcfHeader = values[1];
        this.updateVisibleChromosomes(this._xScale);
        this.loadSvData();
      });
     
      

      this.worker = worker;
      this.valueScaleTransform = HGC.libraries.d3Zoom.zoomIdentity;

      this.trackId = this.id;
      this.viewId = context.viewUid;

      // we scale the entire view up until a certain point
      // at which point we redraw everything to get rid of
      // artifacts
      // this.drawnAtScale keeps track of the scale at which
      // we last rendered everything
      this.drawnAtScale = HGC.libraries.d3Scale.scaleLinear();
      this.variantsInView = [];
      

      // graphics for highliting reads under the cursor
      this.mouseOverGraphics = new HGC.libraries.PIXI.Graphics();
      this.loadingText = new HGC.libraries.PIXI.Text('Loading', {
        fontSize: '12px',
        fontFamily: 'Arial',
        fill: 'grey',
      });

      this.loadingText.x = 40;
      this.loadingText.y = 110;

      this.loadingText.anchor.x = 0;
      this.loadingText.anchor.y = 0;

      this.fetching = new Set();
      this.rendering = new Set();

      this.isShowGlobalMousePosition = context.isShowGlobalMousePosition;

      if (this.options.showMousePosition && !this.hideMousePosition) {
        this.hideMousePosition = HGC.utils.showMousePosition(
          this,
          this.is2d,
          this.isShowGlobalMousePosition(),
        );
      }

      this.maxVariantLength = this.options.maxVariantLength;
      this.minVariantLength = this.options.minVariantLength;
      this.showDelly = this.options.showDelly;
      this.showLumpy = this.options.showLumpy;
      this.showBreakdancer = this.options.showBreakdancer;
      this.showCnvnator = this.options.showCnvnator;
      this.minSupport = this.options.minSupport;

      this.pLabel.addChild(this.loadingText);
      this.setUpShaderAndTextures();


    }

    initTile(tile) {
      tile.bgGraphics = new HGC.libraries.PIXI.Graphics();
      tile.graphics.addChild(tile.bgGraphics);
    }

    getChromInfoDataPromise(chromSizesUrl){
      return new Promise((resolve) => {
        ChromosomeInfo(chromSizesUrl, resolve);
      });
    }

    updateVisibleChromosomes(newXScale){
      if(!this.chromInfo){
        return;
      }

      this.visibleChromosomes = [];
      const chrA = absToChr(newXScale.domain()[0], this.chromInfo)[0]
      const chrB = absToChr(newXScale.domain()[1], this.chromInfo)[0]
      const chrAId = this.chromInfo.chrPositions[chrA].id
      const chrBId = this.chromInfo.chrPositions[chrB].id

      for(var i=chrAId; i<=chrBId; i++){
        this.visibleChromosomes.push(this.chromInfo.cumPositions[i].chr)
      }
    }

    loadSvData(){
      if(!this.vcfHeader){
        return;
      }
      if(!this.chromInfo){
        return;
      }
      
      this.visibleChromosomes.forEach((chr) => {
        if (!(chr in this.svDataPerChromosome)){
          this.updateLoadingText();
          this.svDataPerChromosome[chr] = [];
          this.loadChrSvData(chr);
        }
        
      });


    }

    // This can only be called then chromInfo has loaded
    loadChrSvData(chr){
      
      const tbiVCFParser = new VCF({ header: this.vcfHeader });
      const { chromLengths, cumPositions, chrPositions } = this.chromInfo;
      this.vcfFile.getLines(chr, 0, chromLengths[chr], (line) => {
        const vcfRecord = tbiVCFParser.parseLine(line);
        const vcfJson = vcfRecordToJson(
          vcfRecord,
          chr,
          cumPositions[chrPositions[chr].id].pos
        );
        const segment = vcfJson[0];
        this.svDataPerChromosome[chr].push(segment);
        this.svData.push(segment);
        //vcfJson.forEach((variant) => this.svData.push(variant));
      }).then(() => {
        this.variantAligner.segmentsToRows(this.svData, this.getSegmentsToRowFilter());
        this.updateLoadingText();
        this.updateExistingGraphics();
      });
      
    }

    getBoundsOfTile(tile) {
      // get the bounds of the tile
      const tileId = +tile.tileId.split('.')[1];
      const zoomLevel = +tile.tileId.split('.')[0]; //track.zoomLevel does not always seem to be up to date
      const tileWidth = +this.tilesetInfo.max_width / 2 ** zoomLevel;
      const tileMinX = this.tilesetInfo.min_pos[0] + tileId * tileWidth; // abs coordinates
      const tileMaxX = this.tilesetInfo.min_pos[0] + (tileId + 1) * tileWidth;

      return [tileMinX, tileMaxX];
    }

    setUpShaderAndTextures() {
      const colorDict = PILEUP_COLORS;

      if (this.options && this.options.colorScale) {
        [
          colorDict.INSERTION,
          colorDict.DELETION,
          colorDict.INVERSION,
          colorDict.TRANSLOCATION,
          colorDict.DUPLICATION,
        ] = this.options.colorScale.map((x) => x);
      }

      const colors = Object.values(colorDict);

      const [colorMapTex, colorMapTexRes] = createColorTexture(
        HGC.libraries.PIXI,
        colors,
      );
      const uniforms = new HGC.libraries.PIXI.UniformGroup({
        uColorMapTex: colorMapTex,
        uColorMapTexRes: colorMapTexRes,
      });
      this.shader = HGC.libraries.PIXI.Shader.from(
        `
    attribute vec2 position;
    attribute float aColorIdx;

    uniform mat3 projectionMatrix;
    uniform mat3 translationMatrix;

    uniform sampler2D uColorMapTex;
    uniform float uColorMapTexRes;

    varying vec4 vColor;

    void main(void)
    {
        // Half a texel (i.e., pixel in texture coordinates)
        float eps = 0.5 / uColorMapTexRes;
        float colorRowIndex = floor((aColorIdx + eps) / uColorMapTexRes);
        vec2 colorTexIndex = vec2(
          (aColorIdx / uColorMapTexRes) - colorRowIndex + eps,
          (colorRowIndex / uColorMapTexRes) + eps
        );
        vColor = texture2D(uColorMapTex, colorTexIndex);

        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    }

`,
        `
varying vec4 vColor;

    void main(void) {
        gl_FragColor = vColor;
    }
`,
        uniforms,
      );
    }

    rerender(options) {

      super.rerender(options);   
      this.options = options;

      if (this.options.showMousePosition && !this.hideMousePosition) {
        this.hideMousePosition = HGC.utils.showMousePosition(
          this,
          this.is2d,
          this.isShowGlobalMousePosition(),
        );
      }

      if (!this.options.showMousePosition && this.hideMousePosition) {
        this.hideMousePosition();
        this.hideMousePosition = undefined;
      }

      if(
        this.maxVariantLength !== this.options.maxVariantLength || 
        this.minVariantLength !== this.options.minVariantLength ||
        this.showDelly !== this.options.showDelly ||
        this.showLumpy !== this.options.showLumpy ||
        this.showBreakdancer !== this.options.showBreakdancer ||
        this.showCnvnator !== this.options.showCnvnator ||
        this.minSupport !== this.options.minSupport
        ){

          this.maxVariantLength = this.options.maxVariantLength;
          this.minVariantLength = this.options.minVariantLength;
          this.showDelly = this.options.showDelly;
          this.showLumpy = this.options.showLumpy;
          this.showBreakdancer = this.options.showBreakdancer;
          this.showCnvnator = this.options.showCnvnator;
          this.minSupport = this.options.minSupport;

          // We have to recompute the row number
          this.svData.forEach((segment) => {
            segment.row = null;
          });
          this.variantAligner.segmentsToRows(this.svData, this.getSegmentsToRowFilter());
          // We have to regenerate labels when segment rows change
          this.svTexts = {};
      }

      this.setUpShaderAndTextures();
      this.updateExistingGraphics();
      
    }

    getSegmentsToRowFilter(){
      return {
        minVariantLength: this.minVariantLength,
        maxVariantLength: this.maxVariantLength,
        showDelly: this.showDelly,
        showLumpy: this.showLumpy,
        showBreakdancer: this.showBreakdancer,
        showCnvnator: this.showCnvnator,
        minSupport: this.minSupport,
      }
    }

    updateExistingGraphics() {
      this.loadingText.text = 'Rendering...';

      if (
        !eqSet(this.visibleTileIds, new Set(Object.keys(this.fetchedTiles)))
      ) {
        this.updateLoadingText();
        return;
      }

      const fetchedTileKeys = Object.keys(this.fetchedTiles);
      fetchedTileKeys.forEach((x) => {
        this.fetching.delete(x);
        this.rendering.add(x);
      });
      this.updateLoadingText();

      if(this.svData.length === 0){
        console.log("Data has not loaded yet.")
        return;
      }

      this.worker.then((tileFunctions) => {
        tileFunctions
          .renderSegments(
            this.dataFetcher.uid,
            Object.values(this.fetchedTiles).map((x) => x.remoteId),
            this._xScale.domain(),
            this._xScale.range(),
            this.options,
            this.svData
          )
          .then((toRender) => {
            this.loadingText.visible = false;
            fetchedTileKeys.forEach((x) => {
              this.rendering.delete(x);
            });
            this.updateLoadingText();

            this.errorTextText = null;
            this.pBorder.clear();
            this.drawError();
            this.animate();

            this.positions = new Float32Array(toRender.positionsBuffer);
            this.colors = new Float32Array(toRender.colorsBuffer);
            this.ixs = new Int32Array(toRender.ixBuffer);

            const newGraphics = new HGC.libraries.PIXI.Graphics();

            this.variantsInView = toRender.variants;

            this.numFilteredVariants = toRender.numFilteredVariants;
            this.numVisibleVariants = toRender.numVisibleVariants;

            this.updateSvLabels();
            this.updateFilterNotice();

            const geometry = new HGC.libraries.PIXI.Geometry().addAttribute(
              'position',
              this.positions,
              2,
            ); // x,y
            geometry.addAttribute('aColorIdx', this.colors, 1);
            geometry.addIndex(this.ixs);

            if (this.positions.length) {
              const state = new HGC.libraries.PIXI.State();
              const mesh = new HGC.libraries.PIXI.Mesh(
                geometry,
                this.shader,
                state,
              );

              newGraphics.addChild(mesh);
            }

            this.pMain.x = this.position[0];

            if (this.segmentGraphics) {
              this.pMain.removeChild(this.segmentGraphics);
            }

            this.pMain.addChild(newGraphics);
            this.segmentGraphics = newGraphics;

            // remove and add again to place on top
            this.pMain.removeChild(this.mouseOverGraphics);
            this.pMain.addChild(this.mouseOverGraphics);

            this.drawnAtScale = HGC.libraries.d3Scale
              .scaleLinear()
              .domain(toRender.xScaleDomain)
              .range(toRender.xScaleRange);

            scaleScalableGraphics(
              this.segmentGraphics,
              this._xScale,
              this.drawnAtScale,
            );

            // if somebody zoomed vertically, we want to readjust so that
            // they're still zoomed in vertically
            this.segmentGraphics.scale.y = this.valueScaleTransform.k;
            this.segmentGraphics.position.y = this.valueScaleTransform.y;

            this.draw();
            this.animate();
          });
      });
    }

    updateLoadingText() {
      this.loadingText.visible = true;
      this.loadingText.text = '';

      if (!this.tilesetInfo) {
        this.loadingText.text = 'Fetching tileset info...';
        return;
      }

      if(this.visibleChromosomes.length > Object.keys(this.svDataPerChromosome).length){
        this.loadingText.text = 'Loading variants...';
        return;
      }

      this.loadingText.visible = false;
    }

    draw() {
      this.trackNotFoundText.text = 'Track not found.';
      this.trackNotFoundText.visible = true;
    }

    getMouseOverHtml(trackX, trackYIn) {
      // const trackY = this.valueScaleTransform.invert(track)
      this.mouseOverGraphics.clear();
      // Prevents 'stuck' read outlines when hovering quickly
      requestAnimationFrame(this.animate);
      const trackY = invY(trackYIn, this.valueScaleTransform);
      const vHeight = this.options.variantHeight * this.valueScaleTransform.k;

      const filteredList = this.variantsInView.filter(
        (variant) =>
          this._xScale(variant.from) <= trackX &&
          trackX <= this._xScale(variant.to) &&
          trackY >= variant.yTop + 1 &&
          trackY <= variant.yTop + vHeight + 1,
      );

      if(filteredList.length === 0)
        return '';

      const variant = filteredList[0];

      const fontStyle = `line-height: 12px;font-family: monospace;font-size:14px;`;

      const variantFrom = this._xScale(variant.from);
      const variantTo = this._xScale(variant.to);

      // draw outline
      const width = variantTo - variantFrom;

      this.mouseOverGraphics.lineStyle({
        width: 1,
        color: 0,
      });
      this.mouseOverGraphics.drawRect(
        variantFrom,
        variant.yTop,
        width,
        vHeight,
      );
      this.animate();
      let callers = "-";
      if(variant.callers){
        callers = variant.callers
          .map((caller) => caller.toLowerCase())
          .map((caller) => this.capitalizeFirstLetter(caller))
          .join(', ');
      }
      

      let mouseOverHtml =
        `<table>` +
        `<tr><td>Variant type:</td><td>${SV_TYPE[variant.svtype]}</td></tr>` +
        `<tr><td>Variant ID:</td><td>${variant.id}</td></tr>` +
        `<tr><td>Start position:</td><td>${variant.fromDisp}</td></tr>` +
        `<tr><td>End position:</td><td>${variant.toDisp}</td></tr>` +
        `<tr><td>Average length:</td><td>${variant.avglen}</td></tr>` +
        `<tr><td>Genotype:</td><td>${variant.gt}</td></tr>` +
        `<tr><td>Callers:</td><td>${callers}</td></tr>` +
        `<table>`;

      return mouseOverHtml;

    }

    capitalizeFirstLetter(string) {
      return string.charAt(0).toUpperCase() + string.slice(1);
    }

    calculateZoomLevel() {
      return HGC.utils.trackUtils.calculate1DZoomLevel(
        this.tilesetInfo,
        this._xScale,
        this.maxZoom,
      );
    }

    calculateVisibleTiles() {
      const tiles = HGC.utils.trackUtils.calculate1DVisibleTiles(
        this.tilesetInfo,
        this._xScale,
      );

      for (const tile of tiles) {
        this.errorTextText = null;
        this.pBorder.clear();
        this.drawError();
        this.animate();
      }
      this.setVisibleTiles(tiles);
    }

    setPosition(newPosition) {
      super.setPosition(newPosition);

      [this.pMain.position.x, this.pMain.position.y] = this.position;
      [this.pMouseOver.position.x, this.pMouseOver.position.y] = this.position;

      [this.loadingText.x, this.loadingText.y] = newPosition;
      this.loadingText.x += 30;
    }

    movedY(dY) {
      return;
    }

    zoomedY(yPos, kMultiplier) {
      return;
    }

    zoomed(newXScale, newYScale) {
      super.zoomed(newXScale, newYScale);

      if (this.segmentGraphics) {
        scaleScalableGraphics(
          this.segmentGraphics,
          newXScale,
          this.drawnAtScale,
        );
      }

      this.updateVisibleChromosomes(this._xScale);
      this.updateSvLabels();
      this.loadSvData();
            
      this.mouseOverGraphics.clear();
      this.animate();
    }

    updateSvLabels(){

      this.textGraphics.removeChildren();
      const padding = 5;

      this.variantsInView.forEach((segment) => {

        const segFrom = this._xScale(segment.from);
        const segTo = this._xScale(segment.to);
        const segmentWidth = segTo - segFrom;

        // Rectangle too small - we can't display anything
        if(segmentWidth < 60)
          return;

        if(!(segment.id in this.svTexts)){
          const label = segment.svtype + ", " + segment.avglen + "bp, GT:" + segment.gt;
          this.svTexts[segment.id] = new HGC.libraries.PIXI.BitmapText(label, {fontName: "SVLabel"});
          this.svTexts[segment.id].width = this.svTexts[segment.id].width / 2;
          this.svTexts[segment.id].height = this.svTexts[segment.id].height / 2;
          this.svTexts[segment.id].position.y = segment.row * (this.options.variantHeight+2)+1;
        }
        const textWidth = this.svTexts[segment.id].width;

        const margin = segmentWidth - textWidth - 2*padding
        if(margin < 0)
          return;

        if(segFrom >= 0){
          this.svTexts[segment.id].position.x = segFrom + padding;
        }else if(textWidth + 2*padding < segTo){
          this.svTexts[segment.id].position.x = Math.max(padding,segFrom + padding);
        }else{
          this.svTexts[segment.id].position.x = segTo - textWidth - padding;
        }

        let labelAlpha = 1.0;

        if (margin < 10 && margin >= 0) {
          // gracefully fade out
          const alphaScale = HGC.libraries.d3Scale.scaleLinear()
            .domain([2, 10])
            .range([0, 1])
            .clamp(true);
            labelAlpha = alphaScale(margin);
        }

        this.svTexts[segment.id].alpha = labelAlpha;
        this.textGraphics.addChild(this.svTexts[segment.id]);
      });

    }

    updateFilterNotice(){
      this.labelGraphics.removeChildren();
      this.labelGraphics.clear();

      if(this.numFilteredVariants < this.numVisibleVariants){
        const paddingX = 5;
        const paddingY = 2;
        
  
        const label = `${this.numFilteredVariants} / ${this.numVisibleVariants} SV calls visible`;
        const bitmapText = new HGC.libraries.PIXI.BitmapText(label, {fontName: "FilterLabel"});
        bitmapText.width = bitmapText.width / 2;
        bitmapText.height = bitmapText.height / 2;
        bitmapText.position.x = this.dimensions[0] - bitmapText.width - paddingX;
        bitmapText.position.y = this.dimensions[1] - bitmapText.height - paddingY;
  
        this.labelGraphics.beginFill(0xFFFFFF);
        this.labelGraphics.drawRect(
          bitmapText.position.x - paddingX - 2, 
          bitmapText.position.y - paddingY - 2, 
          bitmapText.width + 2*paddingX + 2, 
          bitmapText.height + 2*paddingY + 2);

        this.labelGraphics.beginFill(0x999999);
        this.labelGraphics.drawRect(
          bitmapText.position.x - paddingX, 
          bitmapText.position.y - paddingY, 
          bitmapText.width + 2*paddingX, 
          bitmapText.height + 2*paddingY);
  
        this.labelGraphics.addChild(bitmapText);
      }
      
    }

    exportSVG() {
      let track = null;
      let base = null;

      if (super.exportSVG) {
        [base, track] = super.exportSVG();
      } else {
        base = document.createElement('g');
        track = base;
      }

      const output = document.createElement('g');
      track.appendChild(output);

      output.setAttribute(
        'transform',
        `translate(${this.pMain.position.x},${this.pMain.position.y}) scale(${this.pMain.scale.x},${this.pMain.scale.y})`,
      );

      const gSegment = document.createElement('g');

      gSegment.setAttribute(
        'transform',
        `translate(${this.segmentGraphics.position.x},${this.segmentGraphics.position.y})` +
          `scale(${this.segmentGraphics.scale.x},${this.segmentGraphics.scale.y})`,
      );

      output.appendChild(gSegment);

      if (this.segmentGraphics) {
        const b64string = HGC.services.pixiRenderer.plugins.extract.base64(
          // this.segmentGraphics, 'image/png', 1,
          this.pMain.parent.parent,
        );

        const gImage = document.createElement('g');

        gImage.setAttribute('transform', `translate(0,0)`);

        const image = document.createElement('image');
        image.setAttributeNS(
          'http://www.w3.org/1999/xlink',
          'xlink:href',
          b64string,
        );
        gImage.appendChild(image);
        gSegment.appendChild(gImage);

        // gSegment.appendChild(image);
      }

      return [base, base];
    }
  }

  return new SvTrackClass(...args);
};

const icon = '<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"> <!-- Created with Method Draw - http://github.com/duopixel/Method-Draw/ --> <g> <title>background</title> <rect fill="#fff" id="canvas_background" height="18" width="18" y="-1" x="-1"/> <g display="none" overflow="visible" y="0" x="0" height="100%" width="100%" id="canvasGrid"> <rect fill="url(#gridpattern)" stroke-width="0" y="0" x="0" height="100%" width="100%"/> </g> </g> <g> <title>Layer 1</title> <rect id="svg_1" height="0.5625" width="2.99997" y="3.21586" x="1.18756" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_3" height="0.5625" width="2.99997" y="7.71582" x="6.06252" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_4" height="0.5625" width="2.99997" y="3.21586" x="1.18756" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_5" height="0.5625" width="2.99997" y="3.90336" x="11.49997" stroke-width="1.5" stroke="#f73500" fill="#000"/> <rect id="svg_6" height="0.5625" width="2.99997" y="7.40333" x="11.62497" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_7" height="0.5625" width="2.99997" y="13.90327" x="5.93752" stroke-width="1.5" stroke="#f4f40e" fill="#000"/> </g> </svg>';

SvTrack.config = {
  type: 'sv',
  datatype: ['vcf'],
  orientation: '1d-horizontal',
  name: 'SV Track',
  thumbnail: new DOMParser().parseFromString(icon, 'text/xml').documentElement,
  availableOptions: [
    'colorScale',
    'showMousePosition',
    'workerScriptLocation',
    'variantHeight',
    'minVariantLength',
    'maxVariantLength',
    'showDelly',
    'showCnvnator',
    'showLumpy',
    'showBreakdancer',
    'minSupport',
    // 'minZoom'
  ],
  defaultOptions: {
    colorScale: [
      // Insertion, Deletion, Inversion, Translocation, Duplication
      [0.6, 0.6, 0.0, 0.7],
      [1, 0.0, 0.0, 0.55],
      [0.68, 0.23, 0.87, 0.8],
      [0.26, 0.52, 0.95, 0.8],
      [0.27, 0.64, 0.09, 0.8]
    ],
    showMousePosition: false,
    variantHeight: 13,
    minVariantLength: 1,
    maxVariantLength: Number.MAX_SAFE_INTEGER,
    showDelly: true,
    showCnvnator: true,
    showLumpy: true,
    showBreakdancer: true,
    minSupport: 1
  },
  optionsInfo: {
    minVariantLength: {
      name: 'Minimal variant length',
      inlineOptions: {
        default: {
          value: 1,
          name: 'No limit',
        },
        bp100: {
          value: 100,
          name: '100bp',
        },
        bp500: {
          value: 500,
          name: '500bp',
        },
        bp1000: {
          value: 1000,
          name: '1000bp',
        },
      },
    },
    maxVariantLength: {
      name: 'Maximal variant length',
      inlineOptions: {
        default: {
          value: Number.MAX_SAFE_INTEGER,
          name: 'No limit',
        },
        bp100000: {
          value: 100000,
          name: '100Kb',
        },
        bp1000000: {
          value: 1000000,
          name: '1Mb',
        },
        bp10000000: {
          value: 10000000,
          name: '10Mb',
        },
      },
    },
    showDelly: {
      name: 'Show Delly SV calls',
      inlineOptions: {
        default: {
          value: true,
          name: 'True',
        },
        no: {
          value: false,
          name: 'False',
        }
      },
    },
    showLumpy: {
      name: 'Show Lumpy SV calls',
      inlineOptions: {
        default: {
          value: true,
          name: 'True',
        },
        no: {
          value: false,
          name: 'False',
        }
      },
    },
    showBreakdancer: {
      name: 'Show Breakdancer SV calls',
      inlineOptions: {
        default: {
          value: true,
          name: 'True',
        },
        no: {
          value: false,
          name: 'False',
        }
      },
    },
    showCnvnator: {
      name: 'Show CNVnator SV calls',
      inlineOptions: {
        default: {
          value: true,
          name: 'True',
        },
        no: {
          value: false,
          name: 'False',
        }
      },
    },
    minSupport: {
      name: 'Minimal SV caller support',
      inlineOptions: {
        default: {
          value: 1,
          name: '1',
        },
        two: {
          value: 2,
          name: '2',
        },
        three: {
          value: 3,
          name: '3',
        },
        four: {
          value: 4,
          name: '4',
        }
      },
    },
    colorScale: {
      name: 'Color scheme',
      inlineOptions: {
        default: {
          value: [
            // Insertion, Deletion, Inversion, Translocation, Duplication
            [0.6, 0.6, 0.0, 0.7],
            [1, 0.0, 0.0, 0.55],
            [0.68, 0.23, 0.87, 0.8],
            [0.26, 0.52, 0.95, 0.8],
            [0.27, 0.64, 0.09, 0.8]
          ],
          name: 'Default',
        },
      },
    },
  },
};

export default SvTrack;
