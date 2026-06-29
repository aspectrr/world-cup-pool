// Cold-cache loading placeholder. Only renders on first-ever visit before any
// cached or fetched data exists. Once localStorage hydrates the hooks, this
// never shows again — refreshes render last-known data instantly (SWR).
//
// ponytail: one generic shimmering-card layout for every tab. Per-tab
// skeletons mirroring each view's exact shape would be nicer but add ~4x the
// markup for a state most users see exactly once.

const ROW_COUNT = 8;

export function Skeleton() {
	return (
		<div className="skeleton-wrap" role="status" aria-label="Loading">
			<div className="skeleton-prize-row">
				{[0, 1, 2].map((i) => (
					<div key={i} className="skeleton-prize" />
				))}
			</div>
			{Array.from({ length: ROW_COUNT }, (_, i) => (
				<div key={i} className="skeleton-card">
					<div className="skeleton-rank" />
					<div className="skeleton-body">
						<div className="skeleton-line skeleton-line-name" />
						<div className="skeleton-chips">
							{Array.from({ length: 6 }, (_, j) => (
								<div key={j} className="skeleton-chip" />
							))}
						</div>
					</div>
					<div className="skeleton-stats">
						<div className="skeleton-line skeleton-line-stat" />
						<div className="skeleton-line skeleton-line-sub" />
					</div>
				</div>
			))}
		</div>
	);
}
