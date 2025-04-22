import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../taskyon/tools'

const openMeteoWeatherTool = createTool({
  description: 'A tool that fetches weather data using the Open-Meteo API.',
  longDescription:
    'This tool uses the Open-Meteo API to retrieve current weather data for a specified location.',
  name: 'openMeteoWeatherTool',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: {
        type: 'number',
        description: 'The latitude of the location for which to fetch weather data.',
      },
      longitude: {
        type: 'number',
        description: 'The longitude of the location for which to fetch weather data.',
      },
    },
  } as const satisfies JSONSchema7,
  code: `({latitude, longitude}) => {
    return fetch(\`https://api.open-meteo.com/v1/forecast?latitude=\${latitude}&longitude=\${longitude}&current_weather=true\`)
      .then(response => response.json())
      .then(data => data.current_weather);
  }`,
})

export const useFullSmallTools = [openMeteoWeatherTool]
