# **Development Policy**

When implementing a new feature or refactoring existing code, there are often multiple possible approaches. The “best” option is not always obvious: a solution that looks suboptimal in a narrow context may prove to be the most effective when viewed from the broader perspective of the entire system.

At **Taskyon**, we follow a set of guiding principles to help us make consistent decisions that prioritize long-term maintainability, flexibility, and developer experience. These principles are listed in descending order of importance. Higher-level rules take precedence over lower-level ones. The policy itself is a living document and will evolve as we learn what works best in practice.

All contributors are encouraged to keep these principles in mind when developing new features, fixing bugs, or performing refactors.

---

### **Core Policies**

- **Local first**
  Favor designs that work offline and synchronize later. Server-based workflows are possible, but in Taskyon we deliberately choose local-first as the default.

- **“Everything is a tool”**
  If a feature can reasonably be expressed as an **AI tool**, we should implement it that way. This makes features composable and reusable, while still allowing exceptions when it would be overkill.

- **AI first, deps second**
  Before introducing external dependencies, evaluate whether AI-assisted development can produce a working in-house solution quickly. Dependencies should only be added when an AI-based approach is clearly insufficient or too costly.

- **Ports are power**
  Cross-boundary communication (e.g., GUI ↔ Taskyon core, client ↔ GUI) must use our **DuplexMessagePort** framework. New functionality should always be offered through ports to maximize composability.

- **P2P, not lock-in**
  Taskyon is one network. There is only one “service” in the p2p world: **Taskyon**. Nodes are peers, not clients. Each instance can contribute its own tools and even offer them to the network, but the interface always stays consistent. Synchronization flows through the p2p network, not centralized services.

- **Diagnostics are part of the product**
  Every feature should provide at least one simple diagnostic function. This ensures the system can test and validate itself incrementally.

- **Secure by default**
  Always use Taskyon’s built-in facilities for security and privacy, such as the encrypted secret store and permission-aware ports. No ad-hoc solutions.

- **Consistency over novelty**
  Prefer patterns and structures that match existing code, even if another option looks “cleverer.”

- **Functions over classes**
  Favor pure functions and composition over object-oriented abstractions. Use classes only when they provide clear, unavoidable advantages.

- **Functional style**
  Prefer immutability, declarative patterns, and isolated side-effects.
