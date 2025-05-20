## Self‑Hosted OpenAI‑Compatible Endpoints

Taskyon’s “OpenAI API Compatibility” feature lets you plug in **any** endpoint that implements the standard `/v1/chat/completions`, `/v1/completions` (and optional embeddings/functions) interfaces—whether that’s OpenAI’s cloud or your own local server. By simply swapping the `base_url` (and using a dummy API key), you maintain **identical** code and UI, while gaining full control over latency, costs, and data privacy.

Below are some of the leading self‑hostable LLM servers you can run on your own hardware—CPU, GPU, or multi‑node clusters—and have Taskyon talk to them as if they were OpenAI:

| Name                       | Description                                                                         | Model Support                                                                    | Install & Usage                                                                                    | Link                                |
| -------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **LocalAI**                | Drop‑in REST API replacement for OpenAI, built on llama.cpp/ggml. No GPU required.  | Any ggml‑compatible weight (LLaMA, Alpaca, GPT4All, Vicuna, RWKV, Whisper, etc.) | `docker run --rm -p 8080:8080 go-skynet/localai`<br/>Point `base_url=http://localhost:8080/v1`     | ([LocalAI][1], [Cloudron Forum][2]) |
| **OpenLLM**                | Python/BentoML framework: spin up any open‑source model as an OpenAI‑style service. | LLaMA 3.x, Qwen, Phi, Mistral, deepseek, custom HF weights, etc.                 | `pip install openllm`<br/>`openllm serve llama3.3 --api=openai`                                    | ([GitHub][3], [vLLM][4])            |
| **Modelz LLM**             | Lightweight inference server with batching, streaming & health‑checks.              | FastChat, LLaMA, ChatGLM, BloomZ, Vicuna, etc.                                   | `pip install modelz-llm`<br/>`modelz-llm -m decapoda-research/llama-7b-hf --device cpu`            | ([GitHub][5])                       |
| **vLLM OpenAI‑Compatible** | High‑performance engine serving HF models over an OpenAI API.                       | Any Hugging Face model or custom weights (incl. GPT4All, LLaMA 3)                | `pip install vllm`<br/>`vllm serve NousResearch/Meta-Llama-3-8B-Instruct --api-key tok`            | ([vLLM][4])                         |
| **LM Studio**              | Desktop & server GUI with built‑in OpenAI mode and model gallery.                   | Mixtral, Qwen, LLaMA 3, Code Llama, Mistral, etc.                                | Download app or `brew install lmstudio`<br/>Flip “Enable Server” in Dev Mode (default port 1234)   | ([LM Studio][6])                    |
| **Ollama**                 | Multi‑platform CLI/daemon with native & OpenAI‑compatible APIs.                     | LLaMA 2, Mistral, Phi 3, Vicuna, Code Llama, etc.                                | Download binary (`ollama.com`), then `ollama pull llama2`<br/>`ollama serve` (HTTP port 11434)     | ([Ollama][7])                       |
| **GPT4All**                | Privacy‑focused desktop + API server for quantized models.                          | Phi‑3 Mini, GPT4All‑J, Vicuna‑quant, etc.                                        | In GPT4All Chat UI → Settings → Enable “Local API Server” (port 4891)<br/>Use `base_url=http://…`  | ([GPT4All][8])                      |
| **Jan/Cortex**             | Electron app & headless Cortex server with OpenAI endpoints.                        | LLaMA.cpp (GGUF), ONNX‑RT, Python backends, etc.                                 | Download Jan (`jan.ai`), Dev Mode → “Start Local API Server” (port 1337)                           | ([Jan][9])                          |

---

### Pointing Taskyon at Your Local Server

In your Taskyon setup (e.g. in JavaScript or via the embedded snippet), simply override the OpenAI base URL:

TODO: Explain taskyon settings for different services...

> **Why this matters for Taskyon**
>
> * **Local First**: Leverage Taskyon’s full feature set—agentic tasks, function calling, embeddings—without sending data offsite.
> * **Cost Control**: No per‑token billing—just pay for your own hardware resources.
> * **Performance**: Zero cloud latency, multi‑GPU or lightweight CPU inference.

For more details on integrating self‑hosted endpoints, see **OpenAI API Compatibility** in the [Taskyon docs](https://taskyon.space/docs/index).

[1]: https://localai.io/?utm_source=chatgpt.com "LocalAI"
[2]: https://forum.cloudron.io/topic/9228/localai-on-cloudron-openai-compatible-api-to-run-llm-large-language-models-models-locally-on-consumer-grade-hardware?utm_source=chatgpt.com "LocalAI on Cloudron: OpenAI compatible API to run LLM (Large ..."
[3]: https://github.com/bentoml/OpenLLM?utm_source=chatgpt.com "bentoml/OpenLLM: Run any open-source LLMs, such as ... - GitHub"
[4]: https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html?utm_source=chatgpt.com "OpenAI-Compatible Server - vLLM"
[5]: https://github.com/tensorchord/modelz-llm?utm_source=chatgpt.com "tensorchord/modelz-llm: OpenAI compatible API for LLMs ... - GitHub"
[6]: https://lmstudio.ai/docs/api/openai-api?utm_source=chatgpt.com "OpenAI Compatibility API | LM Studio Docs"
[7]: https://ollama.com/blog/openai-compatibility?utm_source=chatgpt.com "OpenAI compatibility · Ollama Blog"
[8]: https://docs.gpt4all.io/gpt4all_api_server/home.html?utm_source=chatgpt.com "GPT4All API Server"
[9]: https://jan.ai/docs/api-server?utm_source=chatgpt.com "Local API Server - Jan.ai"
