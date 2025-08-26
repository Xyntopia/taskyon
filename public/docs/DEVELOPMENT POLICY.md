# DEVELOPMENT POLICY

Everytime a choice has to be made, how to implement a new feature, we usually have several options how would approach the challenge. Which one of these options we choose depends on the greater context of
the codebase and one can often come to different conclusions about the _best_ option based on the scope of the context. Sometimes one option that looks like a bad choice in a narrow context turns out
to be the best by a large margin when looking at the bigger picture.

Because of this, in taskyon we are following a policy which tries to take the bigger picture into
account and whenever we make those choices, we should adhere to this policy. Our policy has several rules which are sorted in descending order. Rules which are higher up have priority over lwer ones.
Occasionally we will change our policy when we realize something works better one or another way.

We would like all developers to try to keep this policy in mind whenever we implement a new feature or
correct bugs or do some refactoring:

In Taskon...

- we are local first
- ... "Everything is a tool". If its possible to implement something as a tool, then we should do this.
- communication across system boundaries (e.g. GUI <-> taskyon, client <-> gui) etc.. we should make use of our DuplexMessagePort framework.
- offer new functionality over ports
- only add additional dependencies, if an AI can't write a functionality within a day.
- write functions, not classes
- functional style programming
