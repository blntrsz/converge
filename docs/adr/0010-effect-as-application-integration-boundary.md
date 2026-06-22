# Effect As Application Integration Boundary

Converge uses Effect as the application integration boundary for Proposed Event Processors and related application-owned logic. This lets applications express dependencies, validation, authorization, external service checks, and projection writes in the same Effect-based style while keeping Converge responsible for orchestration and Event History writes.
