# Historical assessment metadata

White-box experimental mode was retired before v1.0. Current BugHunter Web assessments are black-box only. There is no mode selector or source configuration. Authenticated Recon remains externally observable runtime testing with explicitly authorized test accounts.

Migration `20261106090000_black_box_only` sets current Programs to BLACK_BOX and deactivates source records. Tables, enums and immutable historical snapshots remain intact. WHITE_BOX snapshots are documentary history, never execution permission. NULL snapshots remain Legacy / mode not captured.

The former assessment and assessment-sources endpoints return 410 Gone. New Recon, Research sessions and Research Plans use BLACK_BOX with no internal sources. Source locators never seed requests, authorize hosts or create plan objectives.
