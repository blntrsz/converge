# Event History Without Sequence Numbers

Converge represents Event History ordering through Event IDs and Previous Event ID links rather than backend-assigned sequence numbers. This keeps Event IDs as the public continuity mechanism and avoids adding a second ordering concept, accepting that sync and pagination must work from the Event ID chain rather than numeric offsets.
