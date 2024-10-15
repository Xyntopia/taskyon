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
    Object.defineProperty(exports, "initializeTaskyon", {
        enumerable: true,
        get: function() {
            return initializeTaskyon;
        }
    });
    async function initializeTaskyon(tools1, configuration1) {
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
            function sendConfigurationToTaskyon(configuration1) {
                const message = {
                    type: 'configurationMessage',
                    conf: configuration1
                };
                taskyon.contentWindow?.postMessage(message, iframeTarget);
            }
            // Send function definition to the taskyon so that the taskyon is aware of it.
            function sendFunctionToTaskyon(toolDescription) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { function: _toolfunc, ...fdescr } = toolDescription;
                const fdMessage = {
                    type: 'functionDescription',
                    duplicateTaskName: false,
                    ...fdescr
                };
                taskyon.contentWindow?.postMessage(fdMessage, iframeTarget);
            }
            function setUpToolsListener(tools1) {
                window.addEventListener('message', function(event) {
                    // Check the origin to ensure security
                    if (event.origin !== iframeTarget) {
                        console.log('Received message from unauthorized origin');
                        return;
                    }
                    console.log('received message:', event);
                    // Handle function call
                    const tool = tools1[0];
                    if (tool && event.data) {
                        if (event.data.type === 'functionCall') {
                            //if the message comes from taskyon, we can be sure that its the correct type.
                            const data = event.data;
                            const result = tool.function(data.arguments);
                            // Send response to iframe
                            const response = {
                                type: 'functionResponse',
                                functionName: tool.name,
                                response: result
                            };
                            taskyon.contentWindow?.postMessage(response, iframeTarget);
                        }
                    }
                });
            }
            await waitForTaskyonReady();
            console.log('send our configuration!');
            sendConfigurationToTaskyon(configuration1);
            tools1.forEach((t)=>{
                console.log('sending our functions!');
                sendFunctionToTaskyon(t);
                console.log('set up function listener!');
                setUpToolsListener(tools1);
            });
        }
    }
    void initializeTaskyon(tools, configuration);
});

