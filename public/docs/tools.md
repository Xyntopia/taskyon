# Taskyon Tools Documentation

Taskyon offers a flexible and powerful system for integrating and managing tools, allowing users to extend its capabilities according to their needs. This document provides a comprehensive guide on how to use, define, and manage tools within Taskyon.

## Overview of Taskyon Tools

Taskyon tools are modular components that can perform specific tasks or functions. They are designed to be easily integrated into the Taskyon environment, providing users with the ability to customize and extend the system's functionality. Tools in Taskyon can be categorized into three main types:

1. **Internal Tools**: These tools have access to Taskyon's internal settings and can interact directly with the system.
2. **Iframe Parent**: If taskyon is embedded in a webpage, the parent webpage can define functions which can then be defined as a tool for taskyon (see [example](/docs/examples/simpleExampleTutorial)).
3. **Sandboxed Tools**: Tools created by users or external sources are executed in a secure iframe sandbox to ensure system security and integrity.
4. **Out-of-the-Box Tools**: Taskyon provides a set of pre-defined tools that are ready to use.

## Adding New Tools

Taskyon allows users to add arbitrary new tools to the system. This flexibility enables users to tailor Taskyon to their specific needs by integrating custom functionalities. Tools can be defined and managed through the [Tools Manager](/tools), where users can create, edit, and delete tools.

### Creating Tools with the help of LLMs

Taskyon can also define tools using Large Language Models (LLMs). By providing a JSON object as a message and adding a "function" tag, Taskyon can automatically generate tools based on the specified parameters and code. This feature allows for dynamic tool creation and adaptation, leveraging the power of LLMs to enhance Taskyon's capabilities. A good starting point for this is the [Tools Manager](/tools).

TODO: enhance this section with examples.

### Example: Creating a New Tool

Let's say we want to create a tool that takes a string input and returns the string in uppercase. We can define this tool using the following JSON object:

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
  "code": "(input) => {return input.toUpperCase();}"
}
```

This tool definition specifies the tool's name, description, input parameters, and the code to be executed.

### Debugging Tools

You can debug your tool right in the browser! For this you need to open the development tools
(ctrl-shift-I) in chrome & firefox and most other browsers.

When you click on "Sources", Taskyon will create a _.js_ file with the name of the tool. You will
fin the javscript file in the folder: `about:srcdoc -> (no domain) -> <TOOLNAME>.js`
You can add breakpoints and follow the execution of the tool in the browser.

## Tool Definition

Tools in Taskyon are defined using a JSON object. This object specifies the tool's properties, including its name, description, parameters, and the code to be executed.

TODO: full definition

### Example: Tool Definition with Multiple Parameters

Let's say we want to create a tool that takes two numbers as input and returns their sum. We can define this tool using the following JSON object:

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
  "code": "(num1, num2)=>{return num1 + num2;}"
}
```

This tool definition specifies two input parameters, `num1` and `num2`, and returns their sum.

### Secure Execution Environment

To maintain security, Taskyon executes user-defined tools in a sandboxed iframe. This environment restricts the tool's access to the system, allowing only the execution of scripts without any additional permissions. This ensures that tools cannot access or modify Taskyon's internal data or settings or access user data.

In the case of a webpage integration, the tools are defined in the context of the parent of the Taskyon iframe. This means
that taskyon inherently doesn't have access to anything on the webpage that embeds it. Interaction with Taskyon happens
through tools/functions provided to taskyon. Tools can potentially send data from the webpage through a the result returned by a function. Every interaction with taskyon therefore is explicitly granted from your webpage by defining a function.
This ensures 100% control over which data is shared with taskyon and you are
always in control which data is shared to taskyon.

## Built-in Tools

Taskyon comes with several built-in tools that provide essential functionalities out-of-the-box. These tools are ready to use and can be easily integrated into your workflows. Examples of built-in tools include:

- **File Content Retrieval**: A tool to get the contents of an uploaded file.
- **Python Script Execution**: A tool to execute Python scripts and return the results.
- **JS Script Execution**: A tool to execute javascript code and return the results.
- **modifyPrompts**: Taskyon can modify its own prompts here. This makes it easy to quickly evaluate
  different prompts in order to customize Taskyon for your purposes.

## Conclusion

Taskyon's tool system is designed to be flexible, secure, and user-friendly, allowing for extensive customization and integration. Whether you are using built-in tools, creating your own, or leveraging LLMs for dynamic tool generation, Taskyon provides a robust framework for managing and executing tasks efficiently. For more information and to start creating your own tools, visit the [Tools Manager](tools).
