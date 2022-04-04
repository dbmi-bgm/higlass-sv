
v1.0.0

- Breaking change: `dataSource:cgap` has been replaced by `dataSource:cgap-sv`
- Added support for `dataSource:cgap-cnv` which will horizontally align variants according to their log2 copy ratio. Example of a valid data line required for this more:
```
chr4	69256825	BICseq2_DEL_157	.	<DEL>	.	PASS	END=69366582;SVTYPE=DEL;SVLEN=-109757;BICseq2_observed_reads=6020;BICseq2_expected_reads=12658.2;BICseq2_log2_copyRatio=-1.07697883282856;BICseq2_pvalue=7.54729e-66;UNRELATED=0	GT	0/1
```

v0.1.0

- First working version
