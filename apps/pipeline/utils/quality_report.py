from collections import defaultdict


class DataQualityReport:
    def __init__(self):
        self.total_crawled = 0
        self.valid_posts = 0
        self.invalid_posts = 0
        self.empty_content_count = 0
        self.with_risk_flags_count = 0
        self.with_entities_count = 0
        self.platform_counts = defaultdict(int)
        self.invalid_reason_counts = defaultdict(int)
        self.average_quality_score = 0.0

    def analyze(
        self,
        raw_posts: list[dict],
        valid_posts: list[dict],
        invalid_posts: list[dict] | None = None,
    ) -> None:
        invalid_posts = invalid_posts or []

        self.total_crawled = len(raw_posts)
        self.valid_posts = len(valid_posts)
        self.invalid_posts = len(invalid_posts)

        total_score = 0

        for post in valid_posts:
            platform = post.get("platform", "unknown")
            self.platform_counts[platform] += 1

            if not post.get("content", "").strip():
                self.empty_content_count += 1

            if post.get("risk_flags"):
                self.with_risk_flags_count += 1

            if post.get("phone_number") or post.get("account_number") or post.get("kakao_id"):
                self.with_entities_count += 1

            total_score += post.get("data_quality_score", 0)

        for post in invalid_posts:
            reason = post.get("validation_reason", "unknown")
            self.invalid_reason_counts[reason] += 1

        if self.valid_posts > 0:
            self.average_quality_score = total_score / self.valid_posts

    def print_report(self) -> None:
        print("\n" + "=" * 60)
        print("DATA QUALITY REPORT")
        print("=" * 60)

        print("\nOverall Statistics:")
        print(f"  Total Crawled:        {self.total_crawled}")
        print(f"  Valid Posts:          {self.valid_posts}")
        print(f"  Invalid Posts:        {self.invalid_posts}")

        if self.total_crawled > 0:
            validity_rate = (self.valid_posts / self.total_crawled) * 100
            print(f"  Validity Rate:        {validity_rate:.1f}%")

        print("\nContent Quality:")
        print(f"  Records with Empty Content: {self.empty_content_count}")
        print(f"  Records with Risk Flags:    {self.with_risk_flags_count}")
        print(f"  Records with Entities:      {self.with_entities_count}")
        print(f"  Avg. Quality Score:         {self.average_quality_score:.1f}")

        print("\nPlatform Distribution:")
        if not self.platform_counts:
            print("  No valid platform data")
        else:
            for platform, count in sorted(self.platform_counts.items()):
                print(f"  {platform}: {count}")

        if self.invalid_reason_counts:
            print("\nInvalid Reason Distribution:")
            for reason, count in sorted(self.invalid_reason_counts.items()):
                print(f"  {reason}: {count}")

        print("\n" + "=" * 60)