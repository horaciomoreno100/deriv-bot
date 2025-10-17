#!/usr/bin/env python3
"""
Statistical Validation of Pattern and S/R Performance
Tests if differences are statistically significant or just random noise
"""

import sys
import os
import json
import pandas as pd
import numpy as np
from scipy import stats
from pathlib import Path

sys.path.append(os.path.dirname(os.path.abspath(__file__)))


def chi_square_test(group1_wins, group1_total, group2_wins, group2_total):
    """
    Chi-square test for independence
    Tests if win rate difference is statistically significant

    Returns: (chi2_statistic, p_value, is_significant)
    """
    # Create contingency table
    group1_losses = group1_total - group1_wins
    group2_losses = group2_total - group2_wins

    observed = np.array([
        [group1_wins, group1_losses],
        [group2_wins, group2_losses]
    ])

    # Chi-square test
    chi2, p_value, dof, expected = stats.chi2_contingency(observed)

    # Significant if p < 0.05
    is_significant = p_value < 0.05

    return chi2, p_value, is_significant


def binomial_confidence_interval(wins, total, confidence=0.95):
    """
    Calculate binomial confidence interval for win rate

    Returns: (lower_bound, upper_bound)
    """
    if total == 0:
        return (0, 0)

    win_rate = wins / total

    # Wilson score interval (better for small samples)
    z = stats.norm.ppf((1 + confidence) / 2)
    denominator = 1 + z**2 / total
    center = (win_rate + z**2 / (2 * total)) / denominator
    margin = z * np.sqrt(win_rate * (1 - win_rate) / total + z**2 / (4 * total**2)) / denominator

    return (center - margin, center + margin)


def validate_patterns(trades_df):
    """Validate if pattern performance differences are significant"""

    print("\n" + "="*80)
    print("🧪 STATISTICAL VALIDATION: PATTERN PERFORMANCE")
    print("="*80)

    patterns = trades_df['pattern_key'].unique()

    # Calculate stats for each pattern
    pattern_stats = {}
    for pattern in patterns:
        group = trades_df[trades_df['pattern_key'] == pattern]
        total = len(group)
        wins = group['won'].sum()
        win_rate = (wins / total * 100) if total > 0 else 0

        # Confidence interval
        ci_lower, ci_upper = binomial_confidence_interval(wins, total)

        pattern_stats[pattern] = {
            'total': total,
            'wins': wins,
            'win_rate': win_rate,
            'ci_lower': ci_lower * 100,
            'ci_upper': ci_upper * 100
        }

    # Print stats with confidence intervals
    print(f"\n{'Pattern':<20} {'Total':>8} {'Won':>6} {'Win%':>8} {'95% CI':<20} {'Reliable?'}")
    print("-"*80)

    for pattern, stats in sorted(pattern_stats.items(), key=lambda x: x[1]['win_rate'], reverse=True):
        ci_range = f"[{stats['ci_lower']:.1f}% - {stats['ci_upper']:.1f}%]"
        ci_width = stats['ci_upper'] - stats['ci_lower']

        # Narrow CI = more reliable estimate
        reliable = "✅ Yes" if ci_width < 10 and stats['total'] >= 30 else "⚠️  No" if stats['total'] < 30 else "❓ Maybe"

        print(f"{pattern:<20} {stats['total']:>8} {stats['wins']:>6} {stats['win_rate']:>7.2f}% {ci_range:<20} {reliable}")

    # Compare best vs worst patterns
    print("\n" + "="*80)
    print("📊 PAIRWISE COMPARISONS (Chi-Square Tests)")
    print("="*80)

    # Get best and worst patterns
    sorted_patterns = sorted(pattern_stats.items(), key=lambda x: x[1]['win_rate'], reverse=True)
    best_pattern = sorted_patterns[0]
    worst_pattern = sorted_patterns[-1]

    print(f"\n🏆 Best: {best_pattern[0]} ({best_pattern[1]['win_rate']:.2f}%)")
    print(f"💀 Worst: {worst_pattern[0]} ({worst_pattern[1]['win_rate']:.2f}%)")

    # Chi-square test between best and worst
    chi2, p_value, is_sig = chi_square_test(
        best_pattern[1]['wins'], best_pattern[1]['total'],
        worst_pattern[1]['wins'], worst_pattern[1]['total']
    )

    print(f"\n📈 Statistical Test Results:")
    print(f"   Chi-square statistic: {chi2:.4f}")
    print(f"   P-value: {p_value:.4f}")
    print(f"   Significant (p < 0.05)? {'✅ YES' if is_sig else '❌ NO'}")

    if is_sig:
        print(f"\n✅ CONCLUSION: The difference between {best_pattern[0]} and {worst_pattern[0]} is STATISTICALLY SIGNIFICANT")
        print(f"   This means the difference is NOT random - {worst_pattern[0]} is genuinely worse.")
    else:
        print(f"\n⚠️  CONCLUSION: The difference might be due to RANDOM CHANCE")
        print(f"   Need more data to confirm if {worst_pattern[0]} is truly worse.")

    # Compare all patterns against each other
    print("\n" + "-"*80)
    print("ALL PAIRWISE COMPARISONS:")
    print("-"*80)

    comparisons = []
    for i, (p1, s1) in enumerate(sorted_patterns):
        for p2, s2 in sorted_patterns[i+1:]:
            chi2, p_value, is_sig = chi_square_test(
                s1['wins'], s1['total'],
                s2['wins'], s2['total']
            )

            diff = abs(s1['win_rate'] - s2['win_rate'])
            comparisons.append((p1, p2, diff, p_value, is_sig))

    # Sort by difference (largest first)
    comparisons.sort(key=lambda x: x[2], reverse=True)

    print(f"\n{'Pattern A':<15} {'vs':<5} {'Pattern B':<15} {'Diff':>8} {'P-value':>10} {'Significant?'}")
    print("-"*80)

    for p1, p2, diff, p_value, is_sig in comparisons:
        sig_marker = "✅ YES" if is_sig else "❌ NO"
        print(f"{p1:<15} {'vs':<5} {p2:<15} {diff:>7.2f}% {p_value:>10.4f} {sig_marker}")

    return pattern_stats, comparisons


def validate_sr_proximity(trades_df):
    """Validate if S/R proximity affects win rate significantly"""

    print("\n\n" + "="*80)
    print("🧪 STATISTICAL VALIDATION: S/R PROXIMITY")
    print("="*80)

    # Create buckets
    bins = [0, 35, 40, 45, 100]
    labels = ['30-35', '35-40', '40-45', '45+']

    trades_df['sr_bucket'] = pd.cut(trades_df['sr_proximity'], bins=bins, labels=labels, include_lowest=True)

    # Calculate stats for each bucket
    bucket_stats = {}
    for bucket in labels:
        group = trades_df[trades_df['sr_bucket'] == bucket]
        if len(group) == 0:
            continue

        total = len(group)
        wins = group['won'].sum()
        win_rate = (wins / total * 100) if total > 0 else 0

        # Confidence interval
        ci_lower, ci_upper = binomial_confidence_interval(wins, total)

        bucket_stats[bucket] = {
            'total': total,
            'wins': wins,
            'win_rate': win_rate,
            'ci_lower': ci_lower * 100,
            'ci_upper': ci_upper * 100
        }

    # Print stats
    print(f"\n{'S/R Range':<12} {'Total':>8} {'Won':>6} {'Win%':>8} {'95% CI':<20} {'Reliable?'}")
    print("-"*80)

    for bucket, stats in sorted(bucket_stats.items(), key=lambda x: x[1]['win_rate'], reverse=True):
        ci_range = f"[{stats['ci_lower']:.1f}% - {stats['ci_upper']:.1f}%]"
        ci_width = stats['ci_upper'] - stats['ci_lower']

        reliable = "✅ Yes" if ci_width < 15 and stats['total'] >= 20 else "⚠️  No" if stats['total'] < 20 else "❓ Maybe"

        print(f"{bucket:<12} {stats['total']:>8} {stats['wins']:>6} {stats['win_rate']:>7.2f}% {ci_range:<20} {reliable}")

    # Test correlation between S/R proximity and win rate
    print("\n" + "="*80)
    print("📈 CORRELATION TEST: S/R Proximity vs Win Rate")
    print("="*80)

    # Spearman correlation (for ordinal data)
    correlation, p_value = stats.spearmanr(trades_df['sr_proximity'], trades_df['won'])

    print(f"\nSpearman Correlation: {correlation:.4f}")
    print(f"P-value: {p_value:.4f}")
    print(f"Significant (p < 0.05)? {'✅ YES' if p_value < 0.05 else '❌ NO'}")

    if p_value < 0.05:
        if correlation > 0:
            print(f"\n✅ CONCLUSION: Higher S/R proximity SIGNIFICANTLY increases win rate")
            print(f"   Correlation: {correlation:.2f} (positive correlation)")
        else:
            print(f"\n⚠️  CONCLUSION: Higher S/R proximity DECREASES win rate (unexpected!)")
    else:
        print(f"\n❌ CONCLUSION: S/R proximity has NO significant effect on win rate")
        print(f"   The current S/R system may not be working as intended.")

    # Compare low vs high S/R
    low_sr = trades_df[trades_df['sr_proximity'] < 38]
    high_sr = trades_df[trades_df['sr_proximity'] >= 45]

    if len(low_sr) > 0 and len(high_sr) > 0:
        print("\n" + "-"*80)
        print(f"COMPARISON: Low S/R (<38) vs High S/R (≥45)")
        print("-"*80)

        low_wins = low_sr['won'].sum()
        low_total = len(low_sr)
        low_win_rate = (low_wins / low_total * 100) if low_total > 0 else 0

        high_wins = high_sr['won'].sum()
        high_total = len(high_sr)
        high_win_rate = (high_wins / high_total * 100) if high_total > 0 else 0

        print(f"\nLow S/R (<38):  {low_win_rate:.2f}% ({low_wins}/{low_total} trades)")
        print(f"High S/R (≥45): {high_win_rate:.2f}% ({high_wins}/{high_total} trades)")
        print(f"Difference: {high_win_rate - low_win_rate:+.2f}%")

        # Chi-square test
        chi2, p_value, is_sig = chi_square_test(high_wins, high_total, low_wins, low_total)

        print(f"\nChi-square test: p = {p_value:.4f}")
        print(f"Significant? {'✅ YES - High S/R is genuinely better' if is_sig else '❌ NO - Difference might be random'}")

    return bucket_stats


def cross_validate_patterns_by_sr(trades_df):
    """
    Cross-validation: Do bad patterns remain bad at high S/R?
    Or does high S/R fix bad patterns?
    """

    print("\n\n" + "="*80)
    print("🔬 CROSS-VALIDATION: Pattern Performance by S/R Level")
    print("="*80)
    print("\nQuestion: Do 'bad' patterns become good at high S/R proximity?")

    # Split into low/high S/R
    low_sr = trades_df[trades_df['sr_proximity'] < 40]
    high_sr = trades_df[trades_df['sr_proximity'] >= 40]

    patterns = trades_df['pattern_key'].unique()

    print(f"\n{'Pattern':<20} {'Low S/R (<40)':<20} {'High S/R (≥40)':<20} {'Improvement'}")
    print("-"*80)

    for pattern in patterns:
        # Low S/R performance
        low_group = low_sr[low_sr['pattern_key'] == pattern]
        low_total = len(low_group)
        low_wins = low_group['won'].sum() if low_total > 0 else 0
        low_wr = (low_wins / low_total * 100) if low_total > 0 else 0

        # High S/R performance
        high_group = high_sr[high_sr['pattern_key'] == pattern]
        high_total = len(high_group)
        high_wins = high_group['won'].sum() if high_total > 0 else 0
        high_wr = (high_wins / high_total * 100) if high_total > 0 else 0

        # Improvement
        improvement = high_wr - low_wr

        low_str = f"{low_wr:.1f}% ({low_wins}/{low_total})"
        high_str = f"{high_wr:.1f}% ({high_wins}/{high_total})"

        # Determine if pattern improves at high S/R
        if high_total >= 10 and low_total >= 10:
            # Test significance
            chi2, p_value, is_sig = chi_square_test(high_wins, high_total, low_wins, low_total)

            if is_sig and improvement > 5:
                status = "✅ IMPROVES"
            elif is_sig and improvement < -5:
                status = "❌ WORSENS"
            else:
                status = "➡️  NO CHANGE"
        else:
            status = "📊 Low data"

        print(f"{pattern:<20} {low_str:<20} {high_str:<20} {improvement:+6.1f}% {status}")

    print("\n" + "="*80)
    print("💡 INTERPRETATION:")
    print("="*80)
    print("If a pattern IMPROVES at high S/R: S/R filter can help it")
    print("If a pattern STAYS BAD at high S/R: Pattern is fundamentally broken")
    print("="*80)


def main():
    """Run statistical validation"""

    # Find latest results file
    results_files = list(Path(".").glob("detailed_analysis_*.json"))

    if not results_files:
        print("❌ No detailed analysis files found")
        print("   Run: python run_with_analysis.py first")
        return

    latest_file = max(results_files, key=lambda f: f.stat().st_mtime)

    print("🧪 STATISTICAL VALIDATION OF FINDINGS")
    print("="*80)
    print(f"📊 Data: {latest_file}")

    # Load data
    with open(latest_file, 'r') as f:
        results = json.load(f)

    if 'detailed_trades' not in results or not results['detailed_trades']:
        print("❌ No detailed trade data in results")
        return

    trades_df = pd.DataFrame(results['detailed_trades'])

    print(f"📊 Total Trades: {len(trades_df)}")
    print(f"📅 Date Range: {results.get('start_date')} to {results.get('end_date')}")

    # Run validations
    pattern_stats, comparisons = validate_patterns(trades_df)
    bucket_stats = validate_sr_proximity(trades_df)
    cross_validate_patterns_by_sr(trades_df)

    # Final recommendations
    print("\n\n" + "="*80)
    print("🎯 FINAL RECOMMENDATIONS BASED ON STATISTICAL VALIDATION")
    print("="*80)

    # Check which patterns are statistically worse
    print("\n1️⃣  PATTERNS TO REMOVE (Statistically Validated):")

    baseline_wr = 50.16  # Overall win rate

    for pattern, stats in sorted(pattern_stats.items(), key=lambda x: x[1]['win_rate']):
        if stats['total'] >= 30:  # Enough data
            ci_lower = stats['ci_lower']

            # If 95% CI upper bound is below 50%, pattern is reliably bad
            if stats['ci_upper'] < 50:
                print(f"   ❌ {pattern}: {stats['win_rate']:.2f}% (CI: [{ci_lower:.1f}% - {stats['ci_upper']:.1f}%])")
                print(f"      → Even at best case (CI upper), still below 50%")

    print("\n2️⃣  S/R THRESHOLD RECOMMENDATION:")

    # Find optimal S/R threshold
    best_bucket = max(bucket_stats.items(), key=lambda x: x[1]['win_rate'])
    print(f"   ✅ Best S/R range: {best_bucket[0]} ({best_bucket[1]['win_rate']:.2f}%)")

    if best_bucket[0] == '45+':
        print(f"   📌 RECOMMENDATION: Set S/R threshold to 45/100")
    elif best_bucket[0] == '40-45':
        print(f"   📌 RECOMMENDATION: Set S/R threshold to 40/100")
    else:
        print(f"   ⚠️  WARNING: S/R system may not be working correctly")

    print("\n" + "="*80)


if __name__ == "__main__":
    main()
