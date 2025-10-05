import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../types/toolApi'

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

const animatedClockTool = createTool({
  description: 'A tool that generates an animated clock with the current time and date.',
  longDescription:
    'This tool creates an animated clock displayed in a new browser window. The clock shows the current time, seconds, and date with a visually appealing design.',
  name: 'animatedClock',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    required: [],
    properties: {},
  } as const satisfies JSONSchema7,
  code: `() => {
    const html = \`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Animated Clock</title>
<style>
  body {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    background-color: #282c34;
    color: white;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    margin: 0;
  }
  .clock {
    background: #20232a;
    border-radius: 15px;
    padding: 30px;
    box-shadow: 0 0 20px rgba(0, 255, 255, 0.5);
    text-align: center;
    width: 300px;
  }
  .time {
    font-size: 3em;
    letter-spacing: 2px;
    margin-bottom: 10px;
  }
  .date {
    font-size: 1.5em;
    color: #61dafb;
  }
  .seconds {
    font-size: 1em;
    color: #21a1f1;
    animation: pulse 1s infinite;
  }
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>
</head>
<body>
  <div class="clock">
    <div class="time" id="time">00:00</div>
    <div class="seconds" id="seconds">00</div>
    <div class="date" id="date">Loading date...</div>
  </div>

  <script>
    function updateClock() {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      const timeStr = hours + ":" + minutes;
      document.getElementById("time").textContent = timeStr;
      document.getElementById("seconds").textContent = seconds;

      const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
      const dateStr = now.toLocaleDateString(undefined, options);
      document.getElementById("date").textContent = dateStr;
    }

    setInterval(updateClock, 1000);
    updateClock();
  </script>
</body>
</html>
\`;

    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'functioncall',
            data: {
              name: 'newWindowOpener',
              arguments: {
                html,
                windowFeatures: 'width=400,height=300,top=100,left=100,resizable=no,scrollbars=no,toolbar=no,menubar=no,location=no,status=no'
              },
            }
          },
        },
      ],
    ]);
  }`,
})

export const useFullSmallTools = [openMeteoWeatherTool, animatedClockTool]
