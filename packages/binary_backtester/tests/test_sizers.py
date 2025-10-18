#!/usr/bin/env python3
"""
Unit tests for Binary Options Sizers

Tests all sizer implementations:
- FixedSizer: Constant stake
- MartingaleSizer: Double on loss progression
- AntiMartingaleSizer: Double on win progression
"""
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sizers import MartingaleSizer, AntiMartingaleSizer, FixedSizer


class MockTrade:
    """Mock trade object for testing"""
    def __init__(self, pnl, value):
        self.pnl = pnl
        self.value = value
        self.isclosed = True


def test_martingale_doubles_on_loss():
    """
    Test Martingale progression:
    - Doubles stake after each loss
    - Resets to base after win
    """
    print("\n" + "=" * 70)
    print("TEST: Martingale Doubles on Loss")
    print("=" * 70)

    sizer = MartingaleSizer(stake=10.0)

    # Initial state
    print(f"Initial multiplier: {sizer.current_multiplier} (expected: 1)")
    assert sizer.current_multiplier == 1, "Should start at 1x"

    # First loss -> double
    print("\nTrade 1: LOSS (-$10)")
    sizer.notify_trade(MockTrade(pnl=-10, value=10))
    print(f"Multiplier after loss: {sizer.current_multiplier} (expected: 2)")
    assert sizer.current_multiplier == 2, "Should double after loss"

    # Second loss -> double again
    print("\nTrade 2: LOSS (-$20)")
    sizer.notify_trade(MockTrade(pnl=-20, value=20))
    print(f"Multiplier after 2nd loss: {sizer.current_multiplier} (expected: 4)")
    assert sizer.current_multiplier == 4, "Should double again"

    # Win -> reset
    print("\nTrade 3: WIN (+$38)")
    sizer.notify_trade(MockTrade(pnl=+38, value=40))
    print(f"Multiplier after win: {sizer.current_multiplier} (expected: 1)")
    assert sizer.current_multiplier == 1, "Should reset after win"

    print("\n✅ Martingale test PASSED")


def test_anti_martingale_increases_on_win():
    """
    Test Anti-Martingale progression:
    - Increases stake after each win
    - Resets to base after loss
    """
    print("\n" + "=" * 70)
    print("TEST: Anti-Martingale Increases on Win")
    print("=" * 70)

    sizer = AntiMartingaleSizer(stake=10.0)

    # Initial state
    print(f"Initial multiplier: {sizer.current_multiplier} (expected: 1)")
    assert sizer.current_multiplier == 1, "Should start at 1x"

    # First win -> increase
    print("\nTrade 1: WIN (+$9.5)")
    sizer.notify_trade(MockTrade(pnl=+9.5, value=10))
    print(f"Multiplier after win: {sizer.current_multiplier} (expected: 2)")
    assert sizer.current_multiplier == 2, "Should double after win"

    # Second win -> increase again
    print("\nTrade 2: WIN (+$19)")
    sizer.notify_trade(MockTrade(pnl=+19, value=20))
    print(f"Multiplier after 2nd win: {sizer.current_multiplier} (expected: 4)")
    assert sizer.current_multiplier == 4, "Should double again"

    # Loss -> reset
    print("\nTrade 3: LOSS (-$40)")
    sizer.notify_trade(MockTrade(pnl=-40, value=40))
    print(f"Multiplier after loss: {sizer.current_multiplier} (expected: 1)")
    assert sizer.current_multiplier == 1, "Should reset after loss"

    print("\n✅ Anti-Martingale test PASSED")


def test_max_multiplier_cap():
    """
    Test that max_multiplier caps the progression
    """
    print("\n" + "=" * 70)
    print("TEST: Max Multiplier Cap")
    print("=" * 70)

    sizer = MartingaleSizer(stake=10.0, max_multiplier=3)
    print(f"Max allowed: 2^3 = 8x")

    # 5 consecutive losses
    print("\nSimulating 5 consecutive losses...")
    for i in range(5):
        sizer.notify_trade(MockTrade(pnl=-10, value=10))
        print(f"  Loss {i+1}: multiplier = {sizer.current_multiplier}")

    # Should cap at 2^3 = 8
    print(f"\nFinal multiplier: {sizer.current_multiplier} (expected: 8)")
    assert sizer.current_multiplier == 8, f"Should cap at 8, got {sizer.current_multiplier}"

    print("\n✅ Max multiplier test PASSED")


def test_fixed_never_changes():
    """
    Test that FixedSizer always returns same stake
    """
    print("\n" + "=" * 70)
    print("TEST: Fixed Sizer Never Changes")
    print("=" * 70)

    sizer = FixedSizer(stake=10.0)

    print(f"Initial stake: {sizer._calculate_next_stake()} (expected: 10.0)")
    assert sizer._calculate_next_stake() == 10.0, "Should be 10.0"

    # After win
    print("\nAfter WIN:")
    sizer.notify_trade(MockTrade(pnl=+9.5, value=10))
    print(f"Stake: {sizer._calculate_next_stake()} (expected: 10.0)")
    assert sizer._calculate_next_stake() == 10.0, "Should stay 10.0"

    # After loss
    print("\nAfter LOSS:")
    sizer.notify_trade(MockTrade(pnl=-10, value=10))
    print(f"Stake: {sizer._calculate_next_stake()} (expected: 10.0)")
    assert sizer._calculate_next_stake() == 10.0, "Should stay 10.0"

    print("\n✅ Fixed sizer test PASSED")


def test_martingale_progression_sequence():
    """
    Test realistic Martingale sequence with recovery
    """
    print("\n" + "=" * 70)
    print("TEST: Martingale Progression Sequence")
    print("=" * 70)

    sizer = MartingaleSizer(stake=10.0, max_multiplier=5)

    sequence = [
        (-10, 1, 2),   # Loss -> 2x
        (-20, 2, 4),   # Loss -> 4x
        (-40, 4, 8),   # Loss -> 8x
        (+76, 8, 1),   # Win -> reset (76 = 80*0.95 payout)
        (-10, 1, 2),   # Loss -> 2x
        (+19, 2, 1),   # Win -> reset
    ]

    print("\nSimulating realistic trading sequence:")
    for i, (pnl, expected_before, expected_after) in enumerate(sequence, 1):
        result = "WIN" if pnl > 0 else "LOSS"
        print(f"\nTrade {i}: {result} (P/L=${pnl:+.0f})")
        print(f"  Multiplier before: {sizer.current_multiplier} (expected: {expected_before})")
        assert sizer.current_multiplier == expected_before, f"Trade {i}: Wrong multiplier before"

        sizer.notify_trade(MockTrade(pnl=pnl, value=abs(pnl)))

        print(f"  Multiplier after: {sizer.current_multiplier} (expected: {expected_after})")
        assert sizer.current_multiplier == expected_after, f"Trade {i}: Wrong multiplier after"

    print("\n✅ Martingale progression test PASSED")


def test_anti_martingale_progression_sequence():
    """
    Test realistic Anti-Martingale sequence
    """
    print("\n" + "=" * 70)
    print("TEST: Anti-Martingale Progression Sequence")
    print("=" * 70)

    sizer = AntiMartingaleSizer(stake=10.0, max_multiplier=3)

    sequence = [
        (+9.5, 1, 2),   # Win -> 2x
        (+19, 2, 4),    # Win -> 4x
        (+38, 4, 8),    # Win -> 8x (capped)
        (+76, 8, 8),    # Win -> stay at 8x (already at max)
        (-80, 8, 1),    # Loss -> reset
        (+9.5, 1, 2),   # Win -> 2x
    ]

    print("\nSimulating realistic trading sequence:")
    for i, (pnl, expected_before, expected_after) in enumerate(sequence, 1):
        result = "WIN" if pnl > 0 else "LOSS"
        print(f"\nTrade {i}: {result} (P/L=${pnl:+.1f})")
        print(f"  Multiplier before: {sizer.current_multiplier} (expected: {expected_before})")
        assert sizer.current_multiplier == expected_before, f"Trade {i}: Wrong multiplier before"

        sizer.notify_trade(MockTrade(pnl=pnl, value=abs(pnl)))

        print(f"  Multiplier after: {sizer.current_multiplier} (expected: {expected_after})")
        assert sizer.current_multiplier == expected_after, f"Trade {i}: Wrong multiplier after"

    print("\n✅ Anti-Martingale progression test PASSED")


def run_all_tests():
    """Run all sizer tests"""
    print("\n" + "=" * 70)
    print("BINARY OPTIONS SIZERS - UNIT TESTS")
    print("=" * 70)

    tests = [
        test_martingale_doubles_on_loss,
        test_anti_martingale_increases_on_win,
        test_max_multiplier_cap,
        test_fixed_never_changes,
        test_martingale_progression_sequence,
        test_anti_martingale_progression_sequence,
    ]

    passed = 0
    failed = 0

    for test_func in tests:
        try:
            test_func()
            passed += 1
        except AssertionError as e:
            print(f"\n❌ TEST FAILED: {test_func.__name__}")
            print(f"   Error: {e}")
            failed += 1
        except Exception as e:
            print(f"\n❌ TEST ERROR: {test_func.__name__}")
            print(f"   Error: {e}")
            failed += 1

    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    print(f"Total tests: {len(tests)}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print("=" * 70)

    if failed == 0:
        print("\n🎉 ALL SIZER TESTS PASSED!")
        return True
    else:
        print(f"\n⚠️  {failed} test(s) failed")
        return False


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
