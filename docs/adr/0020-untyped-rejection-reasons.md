# Untyped Rejection Reasons

Converge transports rejection reasons as untyped application-owned values. The library guarantees the rejected Event ID and carries a `reason: unknown`, while applications decide whether to structure, decode, display, or ignore the reason.
