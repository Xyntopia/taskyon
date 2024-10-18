# Taskyon Tools Documentation

## Overview

Taskyon offers a flexible and powerful system for integrating and managing tools, allowing users to extend its capabilities. This guide provides comprehensive information on using, defining, and managing tools within Taskyon.

## Tool Categories

Taskyon tools are modular components that perform specific tasks or functions, categorized as follows:

1. **Internal Tools**: Access Taskyon's internal settings and interact directly with the system.
2. **Iframe Parent Tools**: Functions defined by the parent webpage when Taskyon is embedded (see [example](/docs/examples/simpleExampleTutorial)).
3. **Sandboxed Tools**: User-created or external tools executed in a secure iframe sandbox.
4. **Out-of-the-Box Tools**: Pre-defined tools ready for immediate use.

## Tool Management

### Adding New Tools

Users can add custom tools through the [Tools Manager](/tools), where they can create, edit, and delete tools.

#### Best Practice

- Tools should try to always return a value. This give taskyon the feedback whether a tool was succesful or not.
  for example in the function below instead of simply zooming in to the location, we return a string
  based on the success of the function.

```javascript
async function zoomToPlace(placeName) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}`,
    );
    const data = await response.json();

    if (data && data.length > 0) {
      const { lat, lon } = data[0];
      map.setView([lat, lon], 13); // Adjust zoom level as needed
      return {
        success: true,
        message: `Zoomed to ${placeName} at (${lat}, ${lon})`,
      };
    } else {
      return { success: false, message: `Place ${placeName} not found!` };
    }
  } catch (error) {
    return { success: false, message: `Error fetching data: ${error.message}` };
  }
}
```

- Be sure that the function description tells the AI That it can use this function. Consider this function definition here for example:

```javascript
const tools = [
  {
    id: 'mapControl.V1',
    name: 'zoomToPlace',
    description: 'Function to zoom in on a map',
    parameters: {
      type: 'object',
      properties: {
        placeName: {
          type: 'string',
          description: 'The name of the place to zoom to.',
        },
      },
      required: ['placeName'],
    },
    function: (params) => zoomToPlace(params.placeName, true), // Assign the zoom function here
  },
];
```

Better would be a description like this:

```javascript
description: 'This function can be used by the AI to zoom a map displayed on the webpage to a specified place. It returns feedback based on the success of the operation.',
```

Here we address the AI directly and also describe the context of this function in order to make the AI aware of it.

### AI-Assisted Tool Creation

Taskyon can define tools using Large Language Models (LLMs) by providing a JSON object with a "function" tag. This feature enables dynamic tool creation and adaptation.

### Tool Definition

Tools are defined using a JSON object specifying properties such as name, description, parameters, and code. Here's an example of a simple tool that converts a string to uppercase:

```json
{
  "name": "uppercase",
  "description": "Converts a string to uppercase",
  "parameters": {
    "type": "object",
    "properties": {
      "input": {
        "type": "string"
      }
    },
    "required": ["input"]
  },
  "code": "({input}) => input.toUpperCase()"
}
```

For a more complex example with multiple parameters, consider this tool that adds two numbers:

```json
{
  "name": "add",
  "description": "Adds two numbers",
  "parameters": {
    "type": "object",
    "properties": {
      "num1": {
        "type": "number"
      },
      "num2": {
        "type": "number"
      }
    },
    "required": ["num1", "num2"]
  },
  "code": "({num1, num2})=>{return num1 + num2;}"
}
```

## Security and Execution Environment

### Sandboxed Execution

User-defined tools are executed in a sandboxed iframe to maintain security. This environment restricts the tool's access to user data and prevents XSS attacks.

### Webpage Integration

When integrated into a webpage, tools are defined in the context of the parent iframe. This ensures that Taskyon doesn't have direct access to webpage data, and all interactions are explicitly granted through defined functions. This gives the user of Taskyon
integration 100% control over which data is shared.

## Debugging Tools

To debug your tool in the browser:

1. Open the development tools (Ctrl+Shift+I in most browsers).
2. Click on "Sources".
3. Find the JavaScript file with your tool's name in the folder: `about:srcdoc -> (no domain) -> <TOOLNAME>.js`.
4. Add breakpoints and follow the execution in the browser.

## Built-in Tools

Taskyon provides several out-of-the-box tools, including:

- File Content Retrieval
- Python Script Execution
- JS Script Execution
- modifyPrompts (for customizing Taskyon's prompts)

## Conclusion

Taskyon's tool system offers a robust framework for managing and executing tasks efficiently. Its flexibility allows for extensive customization and integration, whether using built-in tools, creating custom ones, or leveraging LLMs for dynamic tool generation.

For more information and to start creating your own tools, visit the [Tools Manager](/tools).
