# Event Sync With Projection Bootstraps

Frontend sync uses Projection Bootstraps for initial Projection state, then receives accepted Events and applies them locally in Event History order. Each Projection has its own Projection Cursor, so Projections can bootstrap at different Event History positions while still catching up by processing accepted Events.
