# Taskyon DAG built-ins

This directory contains trusted generic DAG nodes that execute as part of the Taskyon runtime and
are not editable stored definitions.

`resultQueryNodes.ts` owns generic result flattening, profiling, query, row loading, and chart-query
nodes. Planner-generated structural and reducer expressions remain internal runtime records and do
not appear in this catalog or the editable graph.
