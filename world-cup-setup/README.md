# 2026 World Cup Snake Draft Pool

A spinning wheel draft app for the 2026 FIFA World Cup.

## Setup

```bash
bun install
bun dev
```

## Features

- **Snake draft**: 8 players × 6 teams, pick order reverses each round
- **Group constraint**: Each player gets max 1 team per group (12 groups × 4 teams = 48)
- **Spinning wheel**: Animated wheel with team colors
- **FIFA rankings**: Each team shows their FIFA World Ranking
- **Verified groups**: All 48 teams in correct groups per the Dec 5, 2025 official draw
- **Team flags**: Country flags from flagcdn.com

## Draft Order (Snake)

```
Round 1: P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8
Round 2: P8 → P7 → P6 → P5 → P4 → P3 → P2 → P1
Round 3: P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8
Round 4: P8 → P7 → P6 → P5 → P4 → P3 → P2 → P1
Round 5: P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8
Round 6: P8 → P7 → P6 → P5 → P4 → P3 → P2 → P1
```
