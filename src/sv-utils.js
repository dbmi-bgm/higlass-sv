export const PILEUP_COLORS = {
  VARIANT: [0.3, 0.3, 0.3, 0.6], // gray for the variant background
  LINE: [0.9, 0.9, 0.9, 1], // gray for the variant background
  INSERTION: [0.6, 0.6, 0.0, 0.7],
  DELETION: [1, 0.0, 0.0, 0.55],
  INVERSION: [0.68, 0.23, 0.87, 0.8],
  TRANSLOCATION: [0.26, 0.52, 0.95, 0.8],
  DUPLICATION: [0.27, 0.64, 0.09, 0.8],
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

export const vcfRecordToJson = (vcfRecord, chrName, chrOffset) => {
  const segments = [];
  const info = vcfRecord['INFO'];

  const samplesKey = Object.keys(vcfRecord['SAMPLES'])[0];
  const sample = vcfRecord['SAMPLES'][samplesKey];

  if (vcfRecord['ALT'].length == 0) return segments;

  const svType = info.SVTYPE[0];

  // We are excluding translocations at the moment
  // if(svType == "BND")
  //   return segments;

  let to = 0;
  // console.log(chrName,info.CHR2[0])
  // console.log(info.END[0])
  if (chrName === info.CHR2[0]) {
    to = info.END[0] + chrOffset;
  } else {
    to = vcfRecord.POS + chrOffset + info.AVGLEN[0];
  }

  let calledByDelly = false;
  let calledByCnvnator = false;
  let calledByLumpy = false;
  let calledByBreakdancer = false;

  if (info.CALLERS) {
    calledByDelly = info.CALLERS.includes('DELLY');
    calledByCnvnator = info.CALLERS.includes('CNVNATOR');
    calledByLumpy = info.CALLERS.includes('LUMPY');
    calledByBreakdancer = info.CALLERS.includes('BREAKDANCER');
  }

  const segment = {
    id: vcfRecord['ID'][0],
    svtype: svType,
    from: vcfRecord.POS + chrOffset,
    fromDisp: chrName + ':' + vcfRecord.POS,
    to: to,
    toDisp: info.CHR2[0] + ':' + info.END[0],
    avglen: info.AVGLEN[0],
    chrName,
    chrOffset,
    filter: vcfRecord['FILTER'][0],
    cipos: info.CIPOS, //PE confidence interval around POS
    ciend: info.CIEND, //PE confidence interval around END
    callers: info.CALLERS,
    supp: info.SUPP[0], //Number of callers supporting the variant
    suppVec: info.SUPP_VEC[0], //Vector of supporting samples.
    gt: sample['GT'][0],
    row: null,
    calledByDelly: calledByDelly,
    calledByCnvnator: calledByCnvnator,
    calledByLumpy: calledByLumpy,
    calledByBreakdancer: calledByBreakdancer,
  };

  segments.push(segment);

  return segments;
};
