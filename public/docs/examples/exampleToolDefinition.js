// we can compile this file to js using:
// swc --config-file ./swcrc exampleToolDefinition.ts -o exampleToolDefinition.js
(function(global, factory) {
    if (typeof module === "object" && typeof module.exports === "object") factory(exports);
    else if (typeof define === "function" && define.amd) define([
        "exports"
    ], factory);
    else if (global = typeof globalThis !== "undefined" ? globalThis : global || self) factory(global.exampleToolDefinition = {});
})(this, function(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    const configuration = {
        llmSettings: {
            selectedApi: 'taskyon',
            taskTemplate: {
                allowedTools: [
                    'myExampleStringAdderAlone'
                ]
            }
        },
        signatureOrKey: '2o8zbackwughbck73tqbc3r'
    };
    const tools = [
        {
            id: 'simpleExampleTask.V1',
            name: 'myExampleStringAdderAlone',
            description: 'provide a short description which an AI can understand',
            longDescription: 'provide a long description if the AI/Human needs more details',
            parameters: {
                type: 'object',
                properties: {
                    parameter1: {
                        type: 'string',
                        description: 'This is an example parameter!'
                    },
                    parameter2: {
                        type: 'string',
                        description: 'This is another example parameter, but not required!'
                    }
                },
                required: [
                    'parameter1'
                ]
            },
            function: (data)=>{
                console.log('Received function call with data:', data);
                const result = "".concat(data.parameter1).concat(data.parameter2);
                const outputDiv = document.getElementById('output');
                if (outputDiv) {
                    // Display function call information
                    const output = "Function called with parameters: ".concat(JSON.stringify(data), "<br>Returned: ").concat(JSON.stringify(result));
                    outputDiv.innerHTML = output;
                }
                return result;
            }
        }
    ];
    async function initializeTaskyon(tools, configuration) {
        const taskyon = document.getElementById('taskyon');
        if (taskyon !== null && taskyon.tagName === 'IFRAME' && taskyon.contentWindow !== null) {
            const iframeTarget = new URL(taskyon.src).origin;
            function waitForTaskyonReady() {
                return new Promise((resolve /*reject*/ )=>{
                    const handleMessage = function(event) {
                        const eventOrigin = new URL(event.origin).origin;
                        if (eventOrigin === iframeTarget && event.data.type === 'taskyonReady') {
                            window.removeEventListener('message', handleMessage);
                            console.log('Received message that taskyon is ready!', event);
                            resolve(event);
                        }
                    };
                    console.log('waiting for taskyon to be ready....');
                    window.addEventListener('message', handleMessage);
                });
            }
            // Send function definition to the taskyon so that the taskyon is aware of it.
            function sendConfigurationToTaskyon(configuration) {
                var _taskyon_contentWindow;
                const message = {
                    type: 'configurationMessage',
                    conf: configuration
                };
                (_taskyon_contentWindow = taskyon.contentWindow) === null || _taskyon_contentWindow === void 0 ? void 0 : _taskyon_contentWindow.postMessage(message, iframeTarget);
            }
            // Send function definition to the taskyon so that the taskyon is aware of it.
            function sendFunctionToTaskyon(toolDescription) {
                var _taskyon_contentWindow;
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { function: _toolfunc, ...fdescr } = toolDescription;
                const fdMessage = {
                    type: 'functionDescription',
                    duplicateTaskName: false,
                    ...fdescr
                };
                (_taskyon_contentWindow = taskyon.contentWindow) === null || _taskyon_contentWindow === void 0 ? void 0 : _taskyon_contentWindow.postMessage(fdMessage, iframeTarget);
            }
            function setUpToolsListener(tools) {
                window.addEventListener('message', function(event) {
                    // Check the origin to ensure security
                    if (event.origin !== iframeTarget) {
                        console.log('Received message from unauthorized origin');
                        return;
                    }
                    console.log('received message:', event);
                    // Handle function call
                    const tool = tools[0];
                    if (tool && event.data) {
                        if (event.data.type === 'functionCall') {
                            var _taskyon_contentWindow;
                            //if the message comes from taskyon, we can be sure that its the correct type.
                            const data = event.data;
                            const result = tool.function(data.arguments);
                            // Send response to iframe
                            const response = {
                                type: 'functionResponse',
                                functionName: tool.name,
                                response: result
                            };
                            (_taskyon_contentWindow = taskyon.contentWindow) === null || _taskyon_contentWindow === void 0 ? void 0 : _taskyon_contentWindow.postMessage(response, iframeTarget);
                        }
                    }
                });
            }
            await waitForTaskyonReady();
            console.log('send our configuration!');
            sendConfigurationToTaskyon(configuration);
            tools.forEach((t)=>{
                console.log('sending our functions!');
                sendFunctionToTaskyon(t);
                console.log('set up function listener!');
                setUpToolsListener(tools);
            });
        }
    }
    void initializeTaskyon(tools, configuration);
});

