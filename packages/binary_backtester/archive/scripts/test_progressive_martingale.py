#!/usr/bin/env python3
"""
Test Progressive Anti-Martingale Logic
"""

def simulate_progressive_cycles():
    """Simulate progressive cycles to show the logic"""

    print("="*70)
    print("PROGRESSIVE CYCLES ANTI-MARTINGALE SIMULATION")
    print("="*70)

    # Parameters
    base_stake = 10.0
    payout = 0.95  # 95% payout on wins
    max_win_streak = 2  # Reset after 2 wins
    max_loss_streak = 3  # Reset after 3 losses

    # Win Cycle
    print("\n🟢 WIN CYCLE (3 consecutive wins):")
    print("-" * 70)
    current_stake = base_stake

    for i in range(1, 4):
        profit = current_stake * payout
        next_stake = current_stake + profit

        print(f"Win {i}:")
        print(f"  Stake: ${current_stake:.2f}")
        print(f"  Profit: ${profit:.2f}")
        print(f"  Next Stake: ${next_stake:.2f}")
        print()

        current_stake = next_stake

        if i == max_streak:
            print(f"✅ RESET after {max_streak} wins")
            print(f"   Next Stake: ${base_stake:.2f} (back to base)\n")

    # Loss Cycle
    print("\n🔴 LOSS CYCLE (3 consecutive losses):")
    print("-" * 70)
    current_stake = base_stake

    for i in range(1, 4):
        loss = current_stake
        next_stake = current_stake / 2.0

        print(f"Loss {i}:")
        print(f"  Stake: ${current_stake:.2f}")
        print(f"  Loss: ${loss:.2f}")
        print(f"  Next Stake: ${next_stake:.2f} (half)")
        print()

        current_stake = next_stake

        if i == max_streak:
            print(f"✅ RESET after {max_streak} losses")
            print(f"   Next Stake: ${base_stake:.2f} (back to base)\n")

    # Mixed Scenario
    print("\n🟡 MIXED SCENARIO (wins + losses):")
    print("-" * 70)

    sequence = [
        ('WIN', 1),
        ('WIN', 2),
        ('LOSS', 1),
        ('LOSS', 2),
        ('WIN', 1),
    ]

    current_stake = base_stake
    win_streak = 0
    loss_streak = 0

    for action, count in sequence:
        if action == 'WIN':
            win_streak += 1
            loss_streak = 0
            profit = current_stake * payout
            next_stake = current_stake + profit

            print(f"✅ Win {win_streak}:")
            print(f"   Stake: ${current_stake:.2f} → Profit: ${profit:.2f}")
            print(f"   Next Stake: ${next_stake:.2f}")

            current_stake = next_stake

            if win_streak == max_streak:
                print(f"   🔄 RESET (after 3 wins)")
                current_stake = base_stake
                win_streak = 0

        else:  # LOSS
            loss_streak += 1
            win_streak = 0
            loss = current_stake
            next_stake = current_stake / 2.0

            print(f"❌ Loss {loss_streak}:")
            print(f"   Stake: ${current_stake:.2f} → Loss: ${loss:.2f}")
            print(f"   Next Stake: ${next_stake:.2f}")

            current_stake = next_stake

            if loss_streak == max_streak:
                print(f"   🔄 RESET (after 3 losses)")
                current_stake = base_stake
                loss_streak = 0

        print()

    print("\n" + "="*70)
    print("KEY DIFFERENCES vs OLD MULTIPLIER SYSTEM:")
    print("="*70)
    print("\n✅ OLD (Multiplier System):")
    print("   Win: stake = base * 1.2x")
    print("   Loss: stake = base * 0.5x")
    print("   → Stakes could go to 0.01x (almost zero)")
    print()
    print("✅ NEW (Progressive Cycles):")
    print("   Win: stake = previous_stake + profit")
    print("   Loss: stake = previous_stake / 2")
    print("   → Reset after 3 consecutive wins/losses")
    print("   → More aggressive compounding on wins")
    print("   → Controlled reduction on losses")
    print()

if __name__ == '__main__':
    simulate_progressive_cycles()
