# Tool Examples

Taskyon tools can be small deterministic functions, reusable command workflows, adapters to public
APIs, engineering analysis pipelines, or explicit task trees containing selected model and human
decisions. The examples below show where each kind of work belongs.

| Example                      | Deterministic work                                                                              | Optional model work                                | Main data boundary                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Public trivia quiz           | Validate filters, call the documented API, normalize questions, and score answers               | Generate a themed introduction                     | Public API receives quiz filters                          |
| Legislation provision finder | Ask for required identifiers, retrieve official structured text, and attach versioned citations | Map an ambiguous topic or summarize on request     | Official legal API receives the query                     |
| Local document converter     | Convert, extract, validate, hash, and package PDF, DOCX, spreadsheet, or slide artifacts        | Rewrite prose or review visual layout              | Local unless rewriting is requested                       |
| Personal data anonymizer     | Detect configured identifier formats, transform them, and verify the output                     | Review ambiguous unstructured passages             | Local by default                                          |
| API contract drift auditor   | Normalize OpenAPI files and detect known breaking schema changes                                | Explain uncertain behavioral implications          | Local files or the selected schema host                   |
| Release-readiness gate       | Inspect versions, Git state, changelog, artifacts, and verification commands                    | Group changes into release-note themes             | Local repository                                          |
| Data backfill verifier       | Replay bounded partitions, compare checksums, and detect duplicates                             | Explain an unexpected reconciliation pattern       | Local data systems unless configured otherwise            |
| Parametric CAD workflow      | Generate geometry, export STEP/STL/3MF, and verify dimensions and topology                      | Interpret a sketch or underspecified design intent | Local files by default                                    |
| FEA convergence runner       | Refine the mesh, execute the solver, and stop when selected results converge                    | Explain abnormal convergence behavior              | Local solver and artifacts                                |
| PCB preflight review         | Parse KiCad files, run consistency, BOM, DRC, EMC, thermal, and SPICE checks                    | Review uncertain engineering context               | Local files; supplier APIs only when selected             |
| Autonomous chip-design flow  | Run synthesis, placement, routing, timing, DRC, and GDS generation                              | Explore architecture tradeoffs                     | Local toolchain and selected PDK                          |
| Aircraft mission study       | Execute repeatable payload, range, propulsion, and mission sweeps                               | Explain multidisciplinary tradeoffs                | Local models and solver                                   |
| BIM and structural audit     | Validate IFC relationships, quantities, and structural-analysis inputs                          | Explain design implications                        | Local building model                                      |
| Power-grid contingency study | Run base and N-1 power flows and rank threshold violations                                      | Summarize planning tradeoffs                       | Local network model                                       |
| Robot motion regression      | Validate URDF, replay collision and motion scenarios, and compare metrics                       | Interpret a failed scenario                        | Local simulation; hardware only when explicitly connected |

These examples deliberately separate evidence from interpretation. A model-generated statement is
not a substitute for an engineering solver, official source, standards check, or safety review.
High-consequence tools should expose assumptions, units, versions, tolerances, and residual risk,
and should preserve required human approval gates.

For a larger brainstorming inventory, see
[Tool and Workflow Ideas](tool-and-workflow-ideas.txt). The list is intentionally terse; an idea is
not an implementation specification or a claim that Taskyon currently ships that capability.

## Workflow inspiration

Useful open sources for adapting procedures into deterministic-first tools include
[CAD Skills](https://github.com/earthtojake/text-to-cad),
[KiCad Happy](https://github.com/aklofas/kicad-happy),
[NASA OpenMDAO and Aviary](https://github.com/OpenMDAO),
[OpenROAD](https://github.com/The-OpenROAD-Project/OpenROAD),
[PyPSA](https://github.com/PyPSA/PyPSA), [IDAES](https://idaes.org/software/),
[OpenSees](https://github.com/OpenSees/OpenSees),
[IfcOpenShell](https://github.com/IfcOpenShell/IfcOpenShell), [MoveIt](https://moveit.ai/), and
[OpenSim](https://github.com/opensim-org/opensim-core). Review licenses, versions, scripts,
assumptions, and validation limits before adapting any external workflow.
