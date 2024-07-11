# Best practices of LLM prompting

## In this section of the guide we have compiled a list of best practices that tend to improve the prompt results:

- When choosing the model to work with, the latest and most capable models are likely to perform better.
- Start with a simple and short prompt, and iterate from there.
- Put the instructions at the beginning of the prompt, or at the very end. When working with large context, models apply various optimizations to prevent Attention complexity from scaling quadratically. This may make a model more attentive to the beginning or end of a prompt than the middle.
- Clearly separate instructions from the text they apply to - more on this in the next section.
- Be specific and descriptive about the task and the desired outcome - its format, length, style, language, etc.
- Avoid ambiguous descriptions and instructions.
- Favor instructions that say “what to do” instead of those that say “what not to do”.
- “Lead” the output in the right direction by writing the first word (or even begin the first sentence for the model).
- Use advanced techniques like Few-shot prompting and Chain-of-thought
- Test your prompts with different models to assess their robustness.
- Version and track the performance of your prompts.

##  Advanced prompting techniques

-  Few-shot prompting
-  Chain-of-thought
-  Prompting vs fine-tuning 