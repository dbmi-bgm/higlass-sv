class VariantAligner {
  constructor() {
    
  }

  // See segmentsToRows concerning the role of occupiedSpaceInRows
  assignSegmentToRow(segment, occupiedSpaceInRows, padding) {
    const segmentFromWithPadding = segment.from - padding;
    const segmentToWithPadding = segment.to + padding;

    // no row has been assigned - find a suitable row and update the occupied space
    if (segment.row === null || segment.row === undefined) {
      // Go through each row and look if there is space for the segment
      for (let i = 0; i < occupiedSpaceInRows.length; i++) {
        if (!occupiedSpaceInRows[i]) {
          return;
        }
        const rowSpaceFrom = occupiedSpaceInRows[i].from;
        const rowSpaceTo = occupiedSpaceInRows[i].to;
        if (segmentToWithPadding < rowSpaceFrom) {
          segment.row = i;
          occupiedSpaceInRows[i] = {
            from: segmentFromWithPadding,
            to: rowSpaceTo,
          };
          return;
        } else if (segmentFromWithPadding > rowSpaceTo) {
          segment.row = i;
          occupiedSpaceInRows[i] = {
            from: rowSpaceFrom,
            to: segmentToWithPadding,
          };
          return;
        }
      }
      // There is no space in the existing rows, so add a new one.
      segment.row = occupiedSpaceInRows.length;
      occupiedSpaceInRows.push({
        from: segmentFromWithPadding,
        to: segmentToWithPadding,
      });
    }
   
  }

  segmentsToRows(segments, filter, dataSource) {
    const padding = 5;


    // The following array contains elements fo the form
    // occupiedSpaceInRows[i] = {from: 100, to: 110}
    // This means that in row i, the space from 100 to 110 is occupied and reads cannot be placed there
    // This array is updated with every segment that is added to the scene
    let occupiedSpaceInRows = [];
    let filteredSegments = segments.filter((x) => x.row === null);

    if(dataSource === "parliament2"){
      filteredSegments = filteredSegments.filter((x) =>
        ( (x.calledByLumpy && filter.showLumpy) || 
          (x.calledByDelly && filter.showDelly) ||
          (x.calledByBreakdancer && filter.showBreakdancer) ||
          (x.calledByCnvnator && filter.showCnvnator) ||
          (x.calledByBreakseq2 && filter.showBreakseq2) ||
          (x.calledByManta && filter.showManta) ||
          // calls can be confirmed by SVTyper without having a CALLER in the info field
          x.callers === undefined) &&
        x.supp >= filter.minSupport
        );
    }

    // Length and variant type filtering is applied to every data source
    filteredSegments = filteredSegments.filter((x) =>
      (x.to-x.from >= filter.minVariantLength) && 
      (x.to-x.from <= filter.maxVariantLength) &&
      ( (x.svtype === "DEL" && filter.showDeletions) || 
        (x.svtype === "DUP" && filter.showDuplications) || 
        (x.svtype === "INS" && filter.showInsertions) || 
        (x.svtype === "INV" && filter.showInversions)
      )
      );

    filteredSegments.sort((a, b) => a.from - b.from);
    filteredSegments.forEach((segment) => {
      this.assignSegmentToRow(segment, occupiedSpaceInRows, padding);

    });

  }

  // filterCaller(segment, filter){
  //   if(segment.callers === undefined)
  //     return true;

  //   const numCallers = segment.callers.length;
  //   let score = 0;
  //   if(filter.showLumpy && segment.calledByLumpy){
  //     score += 1;
  //   }else if(filter.showDelly && segment.calledByDelly){
  //     score += 1;
  //   }else if(filter.showBreakdancer && segment.calledByBreakdancer){
  //     score += 1;
  //   }else if(filter.showCnvnator && segment.calledByCnvnator){
  //     score += 1;
  //   }
    
  // }

  
}

export default VariantAligner;
