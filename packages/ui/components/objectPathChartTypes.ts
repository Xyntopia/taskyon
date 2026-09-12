import type { PlotResolution } from '@taskyon/common/modules/plotMath'

export type AxisTransform =
  | { kind: 'scalar' }
  | { kind: 'aggregate'; op: 'mean' | 'sum' | 'min' | 'max' }
  | { kind: 'index'; index: number }

export type ObjectPathChartDefinition = {
  kind?: 'plot' | 'map' | undefined
  plotMode?: '2d' | 'heatmap' | undefined
  x?: string | undefined
  y?: string | undefined
  z?: string | undefined
  xAxisTransform?: AxisTransform | undefined
  yAxisTransform?: AxisTransform | undefined
  zAxisTransform?: AxisTransform | undefined
  latPath?: string | undefined
  lonPath?: string | undefined
  valuePath?: string | undefined
  valueAxisTransform?: AxisTransform | undefined
  featurePath?: string | undefined
  showContour?: boolean | undefined
  showFeatures?: boolean | undefined
  resolution?: PlotResolution | undefined
  title?: string | undefined
  objectFeaturePath?: string | undefined
  seriesMetaPath?: string | undefined
  showZoomToMarkedButton?: boolean | undefined
  zoomToMarkedLayerIds?: string[] | undefined
  bindingProjectId?: string | undefined
  bindingProblemId?: string | undefined
  bindingMode?: 'live' | undefined
  lastResolvedRunSetId?: string | undefined
}
