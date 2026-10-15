import { buildFeatureValueLayer, normalizeMapCategoryStyles } from './plotMapLayers'

export const testMapCategoryStylesAllowAutomaticColors = () => {
  const styles = normalizeMapCategoryStyles({
    P: { label: 'Prime farmland', color: '#f4a582' },
    L: { label: 'Local importance' },
  })
  if (!styles) throw new Error('Category labels must be accepted without explicit colors.')
  const rows = ['P', 'L', 'Other'].map((category) => ({
    'feature.type': 'Feature',
    'feature.geometry.type': 'Polygon',
    'feature.geometry.coordinates': [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
    category,
  }))
  const build = (values: unknown[]) =>
    buildFeatureValueLayer(
      values,
      'feature',
      'category',
      () => undefined,
      'automatic-colors',
      '__plotValue',
      undefined,
      styles,
    )
  const layer = build(rows)
  if (layer?.features.length !== 3) throw new Error('Every category must retain its polygon.')
  if (layer.features[0]?.properties?.__plotColor !== '#f4a582')
    throw new Error('An explicit color must take precedence over the generated palette.')
  for (const [index, label] of ['Prime farmland', 'Local importance', 'Other'].entries()) {
    const color = layer.features[index]?.properties?.__plotColor
    if (typeof color !== 'string' || !color)
      throw new Error('Categories without colors must receive an automatic color.')
    if (layer.legend?.find((entry) => entry.label === label)?.color !== color)
      throw new Error('Legend labels must use the same colors as their polygons.')
  }
  const filtered = build([rows[1]!])
  if (filtered?.features[0]?.properties?.__plotColor !== layer.features[1]?.properties?.__plotColor)
    throw new Error('Automatic colors must stay stable when other categories disappear.')
  if (normalizeMapCategoryStyles({ L: { label: 'Local', color: 'invalid-color' } }))
    throw new Error('Invalid explicit colors must still be rejected.')
  return { success: true }
}

export const testMapCollectionUsesSelectedResultRow = () => {
  const rows = ['first', 'second'].map((id) => ({
    'outputs.map.type': 'FeatureCollection',
    'outputs.map.features': [
      {
        type: 'Feature',
        id,
        properties: { label: id },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    ],
  }))
  const build = (rowIndex?: number) =>
    buildFeatureValueLayer(
      rows,
      'outputs.map',
      '',
      () => undefined,
      'collection',
      '__plotValue',
      undefined,
      undefined,
      { featureValuePath: 'id', ...(rowIndex === undefined ? {} : { rowIndex }) },
    )
  const layer = build(1)
  if (
    layer?.features.length !== 1 ||
    layer.features[0]?.id !== 'second' ||
    layer.features[0].properties?.__plotRow !== 1
  )
    throw new Error(
      'A collection map must retain exactly its selected result row and feature identity.',
    )
  if (layer.legend?.[0]?.label !== 'second' || !layer.features[0].properties?.__plotColor)
    throw new Error('Collection features must use the ordinary category color and legend path.')
  if (build(2) !== null)
    throw new Error('Unavailable result rows must not select a different scenario.')
  let rejected = false
  try {
    build()
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('Select a result row')
  }
  if (!rejected) throw new Error('Distinct result collections must not silently overlap.')
  if ('__plotRow' in rows[1]!['outputs.map.features'][0]!.properties)
    throw new Error('Building a map must not mutate the saved result.')
}
