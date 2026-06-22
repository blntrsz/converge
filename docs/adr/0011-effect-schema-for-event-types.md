# Effect Schema For Event Types

Each Event type is defined with Effect Schema. Converge uses those schemas when frontend code records Proposed Events, when sync crosses process boundaries, and when backend Acceptance decodes Events. This makes Event shape validation explicit and keeps versioned Event definitions tied to runtime decoding.
