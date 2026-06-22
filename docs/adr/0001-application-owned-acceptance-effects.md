# Application-Owned Acceptance Effects

Converge lets applications define Acceptance logic as Effects so they can check permissions, validation rules, external services, and update the backend Projection before a Proposed Event enters Event History. If that application-owned processing succeeds, Converge writes the Event into Event History; if it fails, Converge rejects the Proposed Event. This gives applications flexibility, but Converge cannot guarantee that Acceptance logic is pure, reversible, or free of irreversible side effects; applications own that risk.
