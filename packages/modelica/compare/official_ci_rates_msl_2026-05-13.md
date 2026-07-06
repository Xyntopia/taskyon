# Official CI Metrics (MSL)

Source run date: 2026-05-13 (from provided CI log)

## Official gated metrics

| Area | Metric | Current | Baseline | Raw / Notes |
| --- | --- | ---: | ---: | --- |
| Quality gate | Compile rate | 96.92% | 92.31% | 189 / 195 simulatable models |
| Quality gate | Balance rate | 100.00% | 100.00% | of 189 simulatable models |
| Quality gate | Initial balance rate | 100.00% | 100.00% | of 189 simulatable models |
| Simulation gate | Solver/simulation success rate (`current`) | 71.68% | 73.17% | current: 124/173, baseline: 120/164 |
| Simulation gate | Tolerance | 3.50pp | - | pass threshold margin |
| Trace gate | High | 59.46% | 46.73% | models compared below |
| Trace gate | Near | 11.71% | 17.76% | models compared below |
| Trace gate | Deviation | 28.83% | 35.51% | models compared below |
| Trace gate | Models with any bad channel | 32.43% | 40.19% | current models compared: 111, baseline: 107 |

## Official trace counts

| Metric | Current | Baseline |
| --- | ---: | ---: |
| Models compared | 111 | 107 |
| Bad channels | 335 | 924 |
| Severe channels | 68 | 311 |
| Violation mass total | 8.474348e1 | 4.443131e2 |

## Official speed/perf snapshot (informational, not gated)

| Metric | Value |
| --- | ---: |
| System median (`omc/rumoca`) | 2.927e-1 |
| Wall median (`omc/rumoca`) | 5.810e1 |
| Workers | 3 |
| OMC threads | 1 |
| Throughput | 0.352 models/s |
| Throughput per worker | 0.117 models/s |
| Elapsed (reference step) | 511.1s (2.84s/model) |
| MSL parity simulation reference step | 512.17s |
| MSL parity total step time | 1028.53s |

## Additional run counters (same log summary)

| Metric | Value |
| --- | --- |
| Simulatable compilation rate (rounded print) | 96.9% (189 / 195) |
| Non-simulatable non-partial models | 0 |
| Simulation attempted | 173 |
| `sim_ok` | 124 |
| `sim_nan` | 0 |
| `sim_solver_fail` | 13 |
| `sim_timeout` | 36 |
| `sim_balance_fail` | 0 |
| Total sim solver time | 508.23s |
| Total sim wall/system time | 510.47s |
| Trace files written | 123 |
| Trace write errors | 0 |
| Simulation success rate (rounded print) | 71.7% (124 / 173) |
| OMC reference simulation success rate | 97.8% (176 / 180) |

## Source lines used

- `MSL quality gate: PASS compile=96.92% ..., balance=100.00% ..., initial_balance=100.00% ...`
- `MSL simulation gate: PASS current=71.68% (124/173), baseline=73.17% (120/164 ...), tolerance=3.50pp.`
- `MSL trace gate: PASS with baseline: ...`
- `MSL speed metrics (informational only, not gated): ...`
- `Simulation: total=180, ok=176, failed=4, timed_out=0, success_rate=97.8% (176/180)`
- `Simulatable compilation rate: 96.9% (189 compiled / 195 simulatable models)`
