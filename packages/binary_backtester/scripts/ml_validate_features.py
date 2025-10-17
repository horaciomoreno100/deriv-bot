#!/usr/bin/env python3
"""
Validate ML features before training
- Correlation analysis
- Baseline logistic regression
- Feature importance
"""
import json
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import sys


def load_latest_dataset():
    """Load the latest ML dataset"""
    ml_data_dir = Path(__file__).parent.parent / 'ml_data'

    # Find latest metadata
    metadata_files = sorted(ml_data_dir.glob('metadata_*.json'), key=lambda p: p.stat().st_mtime, reverse=True)

    if not metadata_files:
        print("❌ No ML datasets found")
        print("   Run: python scripts/ml_feature_engineering.py")
        return None

    metadata_file = metadata_files[0]
    with open(metadata_file, 'r') as f:
        metadata = json.load(f)

    print(f"📂 Loading dataset: {metadata_file.name}")
    print(f"   Created: {metadata['created_at']}")
    print(f"   Features: {len(metadata['feature_columns'])}")
    print()

    # Load datasets
    train_df = pd.read_parquet(metadata['train_file'])
    val_df = pd.read_parquet(metadata['val_file'])
    test_df = pd.read_parquet(metadata['test_file'])

    return train_df, val_df, test_df, metadata


def analyze_correlations(train_df: pd.DataFrame, feature_columns: list):
    """Analyze feature correlations with target"""
    print("📊 CORRELATION ANALYSIS")
    print("=" * 70)

    # Calculate correlation with target
    correlations = train_df[feature_columns + ['target']].corr()['target'].drop('target')
    correlations = correlations.abs().sort_values(ascending=False)

    print("\n🎯 Top 15 features most correlated with target:")
    print("-" * 70)
    for i, (feature, corr) in enumerate(correlations.head(15).items(), 1):
        bar_length = int(corr * 50)
        bar = '█' * bar_length
        print(f"   {i:2d}. {feature:<20} {corr:.4f} {bar}")

    print(f"\n📈 Correlation statistics:")
    print(f"   Max correlation: {correlations.max():.4f}")
    print(f"   Mean correlation: {correlations.mean():.4f}")
    print(f"   Min correlation: {correlations.min():.4f}")

    if correlations.max() < 0.05:
        print("\n⚠️  WARNING: Very low correlations detected!")
        print("   This suggests features may have weak predictive power.")
        print("   Consider:")
        print("   - Adding more features (volume, order flow)")
        print("   - Using non-linear models (LSTM, XGBoost)")
        print("   - Checking for data leakage or target errors")

    return correlations


def check_multicollinearity(train_df: pd.DataFrame, feature_columns: list, threshold: float = 0.9):
    """Check for highly correlated features (multicollinearity)"""
    print("\n🔍 MULTICOLLINEARITY CHECK")
    print("=" * 70)

    # Calculate feature-feature correlation matrix
    feature_corr = train_df[feature_columns].corr().abs()

    # Find pairs with high correlation
    high_corr_pairs = []
    for i in range(len(feature_corr.columns)):
        for j in range(i + 1, len(feature_corr.columns)):
            if feature_corr.iloc[i, j] > threshold:
                high_corr_pairs.append((
                    feature_corr.columns[i],
                    feature_corr.columns[j],
                    feature_corr.iloc[i, j]
                ))

    if high_corr_pairs:
        print(f"\n⚠️  Found {len(high_corr_pairs)} highly correlated feature pairs (>{threshold}):")
        for feat1, feat2, corr in high_corr_pairs[:10]:  # Show first 10
            print(f"   {feat1} <-> {feat2}: {corr:.4f}")

        if len(high_corr_pairs) > 10:
            print(f"   ... and {len(high_corr_pairs) - 10} more pairs")

        print("\n💡 Consider removing one feature from each pair to reduce multicollinearity")
    else:
        print(f"✅ No highly correlated feature pairs found (threshold: {threshold})")


def baseline_logistic_regression(train_df: pd.DataFrame, val_df: pd.DataFrame, test_df: pd.DataFrame, feature_columns: list):
    """Train baseline logistic regression"""
    print("\n🤖 BASELINE LOGISTIC REGRESSION")
    print("=" * 70)

    # Prepare data
    X_train = train_df[feature_columns].values
    y_train = train_df['target'].values

    X_val = val_df[feature_columns].values
    y_val = val_df['target'].values

    X_test = test_df[feature_columns].values
    y_test = test_df['target'].values

    print(f"\n📊 Training logistic regression...")
    print(f"   Train samples: {len(X_train):,}")
    print(f"   Val samples: {len(X_val):,}")
    print(f"   Test samples: {len(X_test):,}")

    # Train model
    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_train, y_train)

    print("\n✅ Model trained!")

    # Evaluate on all splits
    print("\n📊 PERFORMANCE METRICS")
    print("=" * 70)

    for split_name, X, y in [('Train', X_train, y_train), ('Val', X_val, y_val), ('Test', X_test, y_test)]:
        y_pred = model.predict(X)
        y_proba = model.predict_proba(X)[:, 1]

        accuracy = accuracy_score(y, y_pred)

        # Calculate confusion matrix
        tn, fp, fn, tp = confusion_matrix(y, y_pred).ravel()
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        print(f"\n{split_name}:")
        print(f"   Accuracy: {accuracy:.4f} ({accuracy * 100:.2f}%)")
        print(f"   Precision (CALL): {precision:.4f}")
        print(f"   Recall (CALL): {recall:.4f}")
        print(f"   F1 Score: {f1:.4f}")

        # Confusion matrix
        print(f"\n   Confusion Matrix:")
        print(f"      Predicted PUT  Predicted CALL")
        print(f"   Actual PUT:   {tn:6d}      {fp:6d}")
        print(f"   Actual CALL:  {fn:6d}      {tp:6d}")

    # Feature importance (coefficients)
    print("\n🎯 TOP 10 MOST IMPORTANT FEATURES (by coefficient magnitude)")
    print("=" * 70)

    feature_importance = pd.DataFrame({
        'feature': feature_columns,
        'coefficient': model.coef_[0]
    })
    feature_importance['abs_coef'] = feature_importance['coefficient'].abs()
    feature_importance = feature_importance.sort_values('abs_coef', ascending=False)

    for i, row in feature_importance.head(10).iterrows():
        sign = '+' if row['coefficient'] > 0 else '-'
        print(f"   {row['feature']:<20} {sign} {abs(row['coefficient']):.4f}")

    # Assessment
    print("\n" + "=" * 70)
    print("📊 BASELINE ASSESSMENT")
    print("=" * 70)

    test_accuracy = accuracy_score(y_test, model.predict(X_test))

    if test_accuracy < 0.52:
        print("\n❌ POOR BASELINE (<52% accuracy)")
        print("   Features have very weak predictive power.")
        print("   Recommendations:")
        print("   - Try non-linear models (LSTM, XGBoost, Random Forest)")
        print("   - Add more features (volume, market depth)")
        print("   - Consider that R_75 may not be predictable with technical indicators")
    elif test_accuracy < 0.55:
        print("\n⚠️  WEAK BASELINE (52-55% accuracy)")
        print("   Logistic regression shows some signal but limited.")
        print("   Recommendations:")
        print("   - Try LSTM or other deep learning models")
        print("   - Feature engineering may help (interactions, polynomials)")
        print("   - This is a challenging problem")
    else:
        print("\n✅ PROMISING BASELINE (>55% accuracy)")
        print("   Features show predictive power!")
        print("   Recommendations:")
        print("   - LSTM should perform even better")
        print("   - Consider ensemble methods")
        print("   - Ready for deep learning training")

    return model


def main():
    """Main validation pipeline"""
    print("🎯 ML FEATURE VALIDATION")
    print("=" * 70)
    print()

    # Load dataset
    result = load_latest_dataset()
    if result is None:
        return 1

    train_df, val_df, test_df, metadata = result
    feature_columns = metadata['feature_columns']

    print(f"✅ Loaded datasets:")
    print(f"   Train: {len(train_df):,} samples")
    print(f"   Val:   {len(val_df):,} samples")
    print(f"   Test:  {len(test_df):,} samples")
    print(f"   Features: {len(feature_columns)}")
    print()

    # Correlation analysis
    correlations = analyze_correlations(train_df, feature_columns)

    # Multicollinearity check
    check_multicollinearity(train_df, feature_columns)

    # Baseline model
    model = baseline_logistic_regression(train_df, val_df, test_df, feature_columns)

    print("\n" + "=" * 70)
    print("✅ VALIDATION COMPLETE!")
    print("=" * 70)
    print("\n🎯 Next step: Train LSTM model")
    print("   python scripts/ml_train_model.py")
    print()

    return 0


if __name__ == '__main__':
    sys.exit(main())
