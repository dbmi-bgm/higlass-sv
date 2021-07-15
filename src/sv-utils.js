export const PILEUP_COLORS = {
  VARIANT: [0.3, 0.3, 0.3, 0.6], // gray for the variant background
  LINE: [0.9, 0.9, 0.9, 1], // gray for the variant background
  INSERTION: [0.6, 0.6, 0.0, 0.7],
  INSERTION_LIGHT: [0.6, 0.6, 0.0, 0.3],
  DELETION: [1, 0.0, 0.0, 0.55],
  DELETION_LIGHT: [1, 0.0, 0.0, 0.2],
  INVERSION: [0.68, 0.23, 0.87, 0.8],
  INVERSION_LIGHT: [0.68, 0.23, 0.87, 0.3],
  TRANSLOCATION: [0.26, 0.52, 0.95, 0.8],
  TRANSLOCATION_LIGHT: [0.26, 0.52, 0.95, 0.3],
  DUPLICATION: [0.27, 0.64, 0.09, 0.8],
  DUPLICATION_LIGHT: [0.27, 0.64, 0.09, 0.3],
  BLACK: [0, 0, 0, 1],
  BLACK_05: [0, 0, 0, 0.5],
  WHITE: [1, 1, 1, 1],
};

export const PILEUP_COLOR_IXS = {};
Object.keys(PILEUP_COLORS).map((x, i) => {
  PILEUP_COLOR_IXS[x] = i;

  return null;
});

export const SV_TYPE = {
  DUP: 'Duplication',
  DEL: 'Deletion',
  INV: 'Inversion',
  INS: 'Insertion',
  BND: 'Translocation',
};

export const vcfRecordToJson = (vcfRecord, chrName, chrOffset, dataSource, sampleName) => {
  const segments = [];
  const info = vcfRecord['INFO'];

  if (vcfRecord['ALT'].length == 0) return segments;

  const svType = info.SVTYPE[0];

  let segment = {};
  
  if(dataSource === "gnomad"){
    let from = vcfRecord.POS + chrOffset;
    let to = info.END[0] + chrOffset;
    let toDisp = info.END[0];
    let svLength = +info.SVLEN[0];

    if (svType === "INS" && +vcfRecord.POS === +info.END[0]) {
      to = vcfRecord.POS + chrOffset + svLength;
      toDisp = vcfRecord.POS + svLength;
    }

    if (svType === "INV" && svLength === 0) {
      svLength = to - from + 1;
    }

    segment = {
      id: vcfRecord['ID'][0],
      svtype: svType,
      from: from,
      fromDisp: chrName + ':' + vcfRecord.POS,
      to: to,
      toDisp: chrName + ':' + toDisp,
      svlen: svLength,
      svlenAbs: Math.abs(+svLength),
      chrName,
      chrOffset,
      filter: null,
      row: null,
      AF: +info.AF[0],
      AC: +info.AC[0],
      AN: +info.AN[0],
      // AFR_AF: +info.AFR_AF[0],
      // AFR_AC: +info.AFR_AC[0],
      // AFR_AN: +info.AFR_AN[0],
      // AMR_AF: +info.AMR_AF[0],
      // AMR_AC: +info.AMR_AC[0],
      // AMR_AN: +info.AMR_AN[0],
      // EAS_AF: +info.EAS_AF[0],
      // EAS_AC: +info.EAS_AC[0],
      // EAS_AN: +info.EAS_AN[0],
      // EUR_AF: +info.EUR_AF[0],
      // EUR_AC: +info.EUR_AC[0],
      // EUR_AN: +info.EUR_AN[0],
      // OTH_AF: +info.OTH_AF[0],
      // OTH_AC: +info.OTH_AC[0],
      // OTH_AN: +info.OTH_AN[0],
    };
    
  }
  else if(dataSource === "cgap"){

    let sample = null;
    if(sampleName === false){
      let samplesKey = Object.keys(vcfRecord['SAMPLES'])[0];
      sample = vcfRecord['SAMPLES'][samplesKey];
    }else if(sampleName in vcfRecord['SAMPLES']){
      sample = vcfRecord['SAMPLES'][sampleName];
    }else{
      console.error("Specified sample name not found in vcf.");
      return segments;
    }

    if(sample['GT'][0] === "0/0"){
      return segments;
    }
    
    let to = 0;
    let toDisp = 0;

    if(svType === "INS"){
      console.warn("INS encountered. This is currently not supported in CGAP mode");
      return segments;
    }

    // if (chrName === info.CHR2[0] && svType === "INS" && +vcfRecord.POS === +info.END[0]) {
    //   to = vcfRecord.POS + chrOffset + info.AVGLEN[0];
    //   toDisp = vcfRecord.POS + info.AVGLEN[0];
    // }
    // else if (chrName === info.CHR2[0]) {
    //   to = info.END[0] + chrOffset;
    //   toDisp = info.END[0];
    // } else {
    //   to = vcfRecord.POS + chrOffset + info.AVGLEN[0];
    //   toDisp = vcfRecord.POS + info.AVGLEN[0];
    // }

    to = info.END[0] + chrOffset;
    toDisp = info.END[0];

    let calledByDelly = false;
    let calledByCnvnator = false;
    let calledByLumpy = false;
    let calledByBreakdancer = false;
    let calledByBreakseq2 = false;
    let calledByManta = true;

    // if (info.CALLERS) {
    //   calledByDelly = info.CALLERS.includes('DELLY');
    //   calledByCnvnator = info.CALLERS.includes('CNVNATOR');
    //   calledByLumpy = info.CALLERS.includes('LUMPY');
    //   calledByBreakdancer = info.CALLERS.includes('BREAKDANCER');
    //   calledByBreakseq2 = info.CALLERS.includes('BREAKSEQ');
    //   calledByManta = info.CALLERS.includes('MANTA');
    // }

    segment = {
      id: vcfRecord['ID'][0],
      svtype: svType,
      from: vcfRecord.POS + chrOffset,
      fromDisp: chrName + ':' + vcfRecord.POS,
      to: to,
      toDisp: chrName + ':' + toDisp,
      svlen: info.SVLEN[0],
      svlenAbs: Math.abs(+info.SVLEN[0]),
      chrName,
      chrOffset,
      filter: vcfRecord['FILTER'][0],
      info: info,
      callers: ['Manta'],
      supp: 1, //Number of callers supporting the variant
      gt: sample['GT'][0],
      row: null,
      calledByDelly: calledByDelly,
      calledByCnvnator: calledByCnvnator,
      calledByLumpy: calledByLumpy,
      calledByBreakdancer: calledByBreakdancer,
      calledByBreakseq2: calledByBreakseq2,
      calledByManta: calledByManta,
    };

  }
  // Minimal data requirements
  else
  {

    let sample = null;
    if(sampleName === false){
      let samplesKey = Object.keys(vcfRecord['SAMPLES'])[0];
      sample = vcfRecord['SAMPLES'][samplesKey];
    }else if(sampleName in vcfRecord['SAMPLES']){
      sample = vcfRecord['SAMPLES'][sampleName];
    }else{
      console.error("Specified sample name not found in vcf.");
      return segments;
    }

    let to = info.END[0] + chrOffset;
    let toDisp = info.END[0];
    let svlen = "-";
    if('SVLEN' in info){
      svlen = info.SVLEN[0];
    }

    segment = {
      id: vcfRecord['ID'][0],
      svtype: svType,
      from: vcfRecord.POS + chrOffset,
      fromDisp: chrName + ':' + vcfRecord.POS,
      to: to,
      toDisp: chrName + ':' + toDisp,
      svlen: svlen,
      chrName,
      chrOffset,
      filter: null,
      gt: sample['GT'][0],
      row: null
    };
    segment['svlenAbs'] = Math.abs(segment.to - segment.from);
  }


  segments.push(segment);

  return segments;
};
