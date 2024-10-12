# Structured Responses

- structured responses are required if we want to use the output of an llm for downstream tasks
- we can choose between yaml and json
- llms will make a lot of mistakes in them therefore it is essential to keep them as simple as possible
- try to include as many as possible simple "yes/no" answers in the output
- it makes sense to have multiple questions in there in order to steer the thought process of an llm
- try to have the actual data we want to parse at the end
- lead the llm to providing the correct data with a bunch of yes/no questions

## Parsing strategy

Right now, we do the following steps:

- Present the schema to the llm using zod -> yaml -> simple yaml w comments

- Parse the schema the following way (check in taskWorker.ts the parse function...):
  1. check for strings which look like yaml
  2. convert yaml to js object
  3. convert all keys to lower case
  4. normalize all no, {}, null etc.. into "undefined"
  5. parse type using zod
