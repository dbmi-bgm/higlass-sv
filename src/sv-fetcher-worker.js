import { scaleLinear } from 'd3-scale';
import { expose, Transfer } from 'threads/worker';
import { TabixIndexedFile } from '@gmod/tabix';
import VCF from '@gmod/vcf';
import { RemoteFile } from 'generic-filehandle';
import slugid from 'slugid';
import { PILEUP_COLOR_IXS } from './sv-utils';
import { ChromosomeInfo } from './chrominfo-utils';

function currTime() {
  const d = new Date();
  return d.getTime();
}

// promises indexed by urls
const vcfFiles = {};
const vcfHeaders = {};
const tbiVCFParsers = {};

const MAX_TILES = 20;

// promises indexed by url
const chromSizes = {};
const chromInfos = {};
const tilesetInfos = {};

// indexed by uuid
const dataConfs = {};

const init = (uid, vcfUrl, tbiUrl, chromSizesUrl) => {
  if (!vcfFiles[vcfUrl]) {
    vcfFiles[vcfUrl] = new TabixIndexedFile({
      filehandle: new RemoteFile(vcfUrl),
      tbiFilehandle: new RemoteFile(tbiUrl),
    });

    vcfHeaders[vcfUrl] = vcfFiles[vcfUrl].getHeader();
    // vcfFiles[vcfUrl].getHeader().then(headerText => {
    //   vcfHeaders[vcfUrl] = headerText;
    //   tbiVCFParsers[vcfUrl] = new VCF({ header: headerText });

    // });
  }

  if (chromSizesUrl) {
    chromSizes[chromSizesUrl] =
      chromSizes[chromSizesUrl] ||
      new Promise((resolve) => {
        ChromosomeInfo(chromSizesUrl, resolve);
      });
  }

  dataConfs[uid] = {
    vcfUrl,
    chromSizesUrl,
  };
};

const tilesetInfo = (uid) => {
  const { chromSizesUrl, vcfUrl } = dataConfs[uid];
  const promises = [vcfHeaders[vcfUrl], chromSizes[chromSizesUrl]];

  return Promise.all(promises).then((values) => {
    if (!tbiVCFParsers[vcfUrl]) {
      tbiVCFParsers[vcfUrl] = new VCF({ header: values[0] });
    }

    const TILE_SIZE = 1024;
    const chromInfo = values[1];
    chromInfos[chromSizesUrl] = chromInfo;

    const retVal = {
      tile_size: TILE_SIZE,
      bins_per_dimension: TILE_SIZE,
      max_zoom: Math.ceil(
        Math.log(chromInfo.totalLength / TILE_SIZE) / Math.log(2),
      ),
      max_width: chromInfo.totalLength,
      min_pos: [0],
      max_pos: [chromInfo.totalLength],
    };

    tilesetInfos[uid] = retVal;
    return retVal;
  });
};

// We return an empty tile. We get the data from SvTrack
const tile = async (uid, z, x) => {
  return tilesetInfo(uid).then((tsInfo) => {
    const recordPromises = [];
    const variants = [];

    return Promise.all(recordPromises).then(() => {
      return variants;
    });
  });
};

const fetchTilesDebounced = async (uid, tileIds) => {
  const tiles = {};

  const validTileIds = [];
  const tilePromises = [];

  for (const tileId of tileIds) {
    const parts = tileId.split('.');
    const z = parseInt(parts[0], 10);
    const x = parseInt(parts[1], 10);

    if (Number.isNaN(x) || Number.isNaN(z)) {
      console.warn('Invalid tile zoom or position:', z, x);
      continue;
    }
    validTileIds.push(tileId);
    tilePromises.push(tile(uid, z, x));
  }

  return Promise.all(tilePromises).then((values) => {
    for (let i = 0; i < values.length; i++) {
      const validTileId = validTileIds[i];
      tiles[validTileId] = values[i];
      tiles[validTileId].tilePositionId = validTileId;
    }
    return tiles;
  });
};

///////////////////////////////////////////////////
/// Render Functions
///////////////////////////////////////////////////

const STARTING_POSITIONS_ARRAY_LENGTH = 2 ** 20;
const STARTING_COLORS_ARRAY_LENGTH = 2 ** 21;
const STARTING_INDEXES_LENGTH = 2 ** 21;

let allPositionsLength = STARTING_POSITIONS_ARRAY_LENGTH;
let allColorsLength = STARTING_COLORS_ARRAY_LENGTH;
let allIndexesLength = STARTING_INDEXES_LENGTH;

let allPositions = new Float32Array(allPositionsLength);
let allColors = new Float32Array(allColorsLength);
let allIndexes = new Int32Array(allIndexesLength);

const renderSegments = (
  visibleTileBounds,
  domain,
  scaleRange,
  trackOptions,
  svData,
) => {
  //const t1 = currTime();

  // segments that are filtered out with minVariantLenght/maxVariantLenght have row=null
  const visibleVariants = svData.filter(
    (segment) =>
      segment.to >= visibleTileBounds[0] &&
      segment.from <= visibleTileBounds[1],
  );

  const visibleVariantsFiltered = visibleVariants.filter(
    (segment) => segment.row !== null,
  );

  let segmentList = visibleVariantsFiltered;
  // We additionally truncate segmentList after rows numbers have been assigned.
  // This is for performance reasons and we don't want row numbers to change while zooming
  // Keep only the largest variants
  if (visibleVariantsFiltered.length > trackOptions.maxVariants) {
    segmentList = visibleVariantsFiltered
      .sort((a, b) => b.avglenAbs - a.avglenAbs)
      .slice(0, trackOptions.maxVariants);
  }

  let currPosition = 0;
  let currColor = 0;
  let currIdx = 0;

  const addPosition = (x1, y1) => {
    if (currPosition > allPositionsLength - 2) {
      allPositionsLength *= 2;
      const prevAllPositions = allPositions;

      allPositions = new Float32Array(allPositionsLength);
      allPositions.set(prevAllPositions);
    }
    allPositions[currPosition++] = x1;
    allPositions[currPosition++] = y1;

    return currPosition / 2 - 1;
  };

  const addColor = (colorIdx, n) => {
    if (currColor >= allColorsLength - n) {
      allColorsLength *= 2;
      const prevAllColors = allColors;

      allColors = new Float32Array(allColorsLength);
      allColors.set(prevAllColors);
    }

    for (let k = 0; k < n; k++) {
      //console.log(colorIdx)
      allColors[currColor++] = colorIdx;
    }
  };

  const addTriangleIxs = (ix1, ix2, ix3) => {
    if (currIdx >= allIndexesLength - 3) {
      allIndexesLength *= 2;
      const prevAllIndexes = allIndexes;

      allIndexes = new Int32Array(allIndexesLength);
      allIndexes.set(prevAllIndexes);
    }

    allIndexes[currIdx++] = ix1;
    allIndexes[currIdx++] = ix2;
    allIndexes[currIdx++] = ix3;
  };

  const addRect = (x, y, width, height, colorIdx) => {
    const xLeft = x;
    const xRight = xLeft + width;
    const yTop = y;
    const yBottom = y + height;

    const ulIx = addPosition(xLeft, yTop);
    const urIx = addPosition(xRight, yTop);
    const llIx = addPosition(xLeft, yBottom);
    const lrIx = addPosition(xRight, yBottom);
    addColor(colorIdx, 4);

    addTriangleIxs(ulIx, urIx, llIx);
    addTriangleIxs(llIx, lrIx, urIx);
  };

  const xScale = scaleLinear().domain(domain).range(scaleRange);

  let xLeft;
  let xRight;
  let yTop;

  // Needed to check for duplicates
  segmentList.sort((a, b) => {
    if (a.id < b.id) {
      return -1;
    }
    if (a.id > b.id) {
      return 1;
    }
    return 0;
  });
  let lastSegment = null;

  segmentList.forEach((segment, j) => {
    // Ignore duplicates - can happen when variants span more than one tile
    if (lastSegment && segment.id === lastSegment.id) {
      return;
    }
    //console.log(segment)

    lastSegment = segment;

    const from = xScale(segment.from);
    const to = xScale(segment.to);

    // Start at one, since the graphics starts at 1
    yTop = 1;

    const width = Math.max(1, to - from);

    const padding = 0;

    xLeft = from + padding;
    xRight = to - padding;

    let colorToUse = PILEUP_COLOR_IXS.VARIANT;

    if (
      trackOptions.dataSource === 'gnomad' &&
      segment.AF > trackOptions.gnomadAlleleFrequencyThreshold
    ) {
      if (segment.svtype === 'DEL') {
        colorToUse = PILEUP_COLOR_IXS.DELETION_LIGHT;
      } else if (segment.svtype === 'INS') {
        colorToUse = PILEUP_COLOR_IXS.INSERTION_LIGHT;
      } else if (segment.svtype === 'DUP') {
        colorToUse = PILEUP_COLOR_IXS.DUPLICATION_LIGHT;
      } else if (segment.svtype === 'INV') {
        colorToUse = PILEUP_COLOR_IXS.INVERSION_LIGHT;
      } else if (segment.svtype === 'BND') {
        colorToUse = PILEUP_COLOR_IXS.TRANSLOCATION_LIGHT;
      }
    } else {
      if (segment.svtype === 'DEL') {
        colorToUse = PILEUP_COLOR_IXS.DELETION;
      } else if (segment.svtype === 'INS') {
        colorToUse = PILEUP_COLOR_IXS.INSERTION;
      } else if (segment.svtype === 'DUP') {
        colorToUse = PILEUP_COLOR_IXS.DUPLICATION;
      } else if (segment.svtype === 'INV') {
        colorToUse = PILEUP_COLOR_IXS.INVERSION;
      } else if (segment.svtype === 'BND') {
        colorToUse = PILEUP_COLOR_IXS.TRANSLOCATION;
      }
    }
    segment['yTop'] = segment.row * (trackOptions.variantHeight + 2) + 1;
    yTop = segment['yTop'];
    addRect(
      xLeft,
      yTop,
      width, //xRight - xLeft,
      trackOptions.variantHeight,
      colorToUse,
    );
  });

  const positionsBuffer = allPositions.slice(0, currPosition).buffer;
  const colorsBuffer = allColors.slice(0, currColor).buffer;
  const ixBuffer = allIndexes.slice(0, currIdx).buffer;

  const objData = {
    variants: segmentList,
    positionsBuffer,
    colorsBuffer,
    ixBuffer,
    xScaleDomain: domain,
    xScaleRange: scaleRange,
    numVisibleVariants: visibleVariants.length,
    numFilteredVariants: segmentList.length,
  };

  //const t2 = currTime();
  //console.log('renderSegments time:', t2 - t1, 'ms');

  return Transfer(objData, [objData.positionsBuffer, colorsBuffer, ixBuffer]);
};

const tileFunctions = {
  init,
  tilesetInfo,
  fetchTilesDebounced,
  tile,
  renderSegments,
};

expose(tileFunctions);
