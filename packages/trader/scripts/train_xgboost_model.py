#!/usr/bin/env python3
"""
XGBoost Model Training for Trade Prediction
============================================

This script trains an XGBoost classifier to predict trade outcomes (WIN/LOSS)
based on market features captured during backtesting.

Usage:
    python scripts/train_xgboost_model.py [CSV_FILE]

If no CSV file is provided, it will use the most recent one in analysis-output/

Requirements:
    pip install pandas numpy xgboost scikit-learn matplotlib seaborn
"""

import sys
import os
import glob
from datetime import datetime
import json

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    classification_report, confusion_matrix, roc_auc_score, roc_curve
)
from sklearn.preprocessing import StandardScaler
import xgboost as xgb

# Optional: for visualization
try:
    import matplotlib.pyplot as plt
    import seaborn as sns
    HAS_PLOTTING = True
except ImportError:
    HAS_PLOTTING = False
    print("Warning: matplotlib/seaborn not installed. Charts will be skipped.")


# =============================================================================
# CONFIGURATION
# =============================================================================

# Features to use for training (exclude identifiers and target)
FEATURE_COLUMNS = [
    # Time features
    'hourOfDay',
    'dayOfWeek',
    'minuteOfHour',
    # 'isMarketOpen',  # May not be relevant for synthetic indices

    # Direction
    'directionEncoded',

    # Raw indicators
    'rsi1m',
    'rsi5m',
    'adx15m',

    # Engineered - BB
    'bbWidth',
    'bbWidthPct',
    'pricePositionInBB',
    'distToUpperBB',
    'distToLowerBB',

    # Engineered - RSI
    'rsiDelta1m',
    'rsiDelta5m',
    'rsiDivergence',

    # Engineered - Trend
    'smaSlope15m',
    'distToSma15m',

    # Engineered - Volatility
    'atr1m',
    'candleBodyPct',
    'upperWickPct',
    'lowerWickPct',

    # Regime & Strategy
    'regimeEncoded',
    'strategyEncoded',

    # Signal
    'confidence',

    # Price action
    'priceChange1',
    'priceChange5',
    'priceChange15',
]

# XGBoost hyperparameters
XGBOOST_PARAMS = {
    'objective': 'binary:logistic',
    'eval_metric': 'auc',
    'max_depth': 6,
    'min_child_weight': 1,
    'subsample': 0.8,
    'colsample_bytree': 0.8,
    'learning_rate': 0.1,
    'n_estimators': 100,
    'reg_alpha': 0.1,
    'reg_lambda': 1.0,
    'random_state': 42,
    'use_label_encoder': False,
}


# =============================================================================
# DATA LOADING
# =============================================================================

def find_latest_csv(directory: str = 'analysis-output') -> str:
    """Find the most recent ML training CSV file."""
    pattern = os.path.join(directory, 'ml_training_*.csv')
    files = glob.glob(pattern)

    if not files:
        raise FileNotFoundError(f"No ML training files found in {directory}")

    # Sort by modification time, get most recent
    latest = max(files, key=os.path.getmtime)
    return latest


def load_data(filepath: str) -> pd.DataFrame:
    """Load and validate the training data."""
    print(f"\n📂 Loading data from: {filepath}")

    df = pd.read_csv(filepath)
    print(f"   Total samples: {len(df)}")
    print(f"   Features: {len(df.columns)}")

    # Check for target column
    if 'target' not in df.columns:
        raise ValueError("Missing 'target' column in data")

    # Print class distribution
    target_counts = df['target'].value_counts()
    print(f"\n📊 Target Distribution:")
    print(f"   WIN (1):  {target_counts.get(1, 0)} ({target_counts.get(1, 0)/len(df)*100:.1f}%)")
    print(f"   LOSS (0): {target_counts.get(0, 0)} ({target_counts.get(0, 0)/len(df)*100:.1f}%)")

    return df


def prepare_features(df: pd.DataFrame) -> tuple:
    """Prepare feature matrix and target vector."""
    # Filter to only available features
    available_features = [f for f in FEATURE_COLUMNS if f in df.columns]
    missing_features = [f for f in FEATURE_COLUMNS if f not in df.columns]

    if missing_features:
        print(f"\n⚠️  Missing features (will be skipped): {missing_features}")

    print(f"\n🔧 Using {len(available_features)} features")

    # Extract features and target
    X = df[available_features].copy()
    y = df['target'].copy()

    # Handle missing values
    null_counts = X.isnull().sum()
    if null_counts.any():
        print(f"\n⚠️  Handling null values:")
        for col in null_counts[null_counts > 0].index:
            print(f"   {col}: {null_counts[col]} nulls -> filled with median")
        X = X.fillna(X.median())

    return X, y, available_features


# =============================================================================
# MODEL TRAINING
# =============================================================================

def train_model(X_train, y_train, X_test, y_test) -> xgb.XGBClassifier:
    """Train XGBoost model with early stopping."""
    print("\n🚀 Training XGBoost model...")

    # Calculate scale_pos_weight for class imbalance
    neg_count = (y_train == 0).sum()
    pos_count = (y_train == 1).sum()
    scale_pos_weight = neg_count / pos_count if pos_count > 0 else 1.0

    print(f"   Class imbalance ratio: {scale_pos_weight:.2f}")

    # Create model
    params = XGBOOST_PARAMS.copy()
    params['scale_pos_weight'] = scale_pos_weight

    model = xgb.XGBClassifier(**params)

    # Train with early stopping
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False
    )

    print(f"   Training completed!")
    return model


def evaluate_model(model, X_test, y_test, feature_names: list) -> dict:
    """Evaluate model performance."""
    print("\n📈 Model Evaluation:")
    print("=" * 50)

    # Predictions
    y_pred = model.predict(X_test)
    y_pred_proba = model.predict_proba(X_test)[:, 1]

    # Metrics
    accuracy = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall = recall_score(y_test, y_pred, zero_division=0)
    f1 = f1_score(y_test, y_pred, zero_division=0)
    roc_auc = roc_auc_score(y_test, y_pred_proba)

    print(f"\n   Accuracy:  {accuracy:.4f} ({accuracy*100:.1f}%)")
    print(f"   Precision: {precision:.4f} (of predicted wins, how many were correct)")
    print(f"   Recall:    {recall:.4f} (of actual wins, how many did we catch)")
    print(f"   F1 Score:  {f1:.4f}")
    print(f"   ROC AUC:   {roc_auc:.4f}")

    # Confusion Matrix
    cm = confusion_matrix(y_test, y_pred)
    print(f"\n   Confusion Matrix:")
    print(f"                 Predicted")
    print(f"                 LOSS   WIN")
    print(f"   Actual LOSS   {cm[0,0]:4d}  {cm[0,1]:4d}")
    print(f"   Actual WIN    {cm[1,0]:4d}  {cm[1,1]:4d}")

    # Classification Report
    print(f"\n   Classification Report:")
    print(classification_report(y_test, y_pred, target_names=['LOSS', 'WIN']))

    return {
        'accuracy': accuracy,
        'precision': precision,
        'recall': recall,
        'f1': f1,
        'roc_auc': roc_auc,
        'confusion_matrix': cm.tolist(),
    }


def cross_validate(model, X, y, cv=5) -> dict:
    """Perform stratified k-fold cross-validation."""
    print(f"\n🔄 Cross-Validation ({cv}-fold):")
    print("=" * 50)

    skf = StratifiedKFold(n_splits=cv, shuffle=True, random_state=42)

    # Multiple metrics
    scoring = ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']
    results = {}

    for metric in scoring:
        scores = cross_val_score(model, X, y, cv=skf, scoring=metric)
        results[metric] = {
            'mean': scores.mean(),
            'std': scores.std(),
            'scores': scores.tolist()
        }
        print(f"   {metric:12s}: {scores.mean():.4f} (+/- {scores.std()*2:.4f})")

    return results


# =============================================================================
# FEATURE IMPORTANCE ANALYSIS
# =============================================================================

def analyze_feature_importance(model, feature_names: list) -> pd.DataFrame:
    """Analyze and rank feature importance."""
    print("\n🎯 Feature Importance Analysis:")
    print("=" * 50)

    # Get feature importance (gain-based)
    importance = model.feature_importances_

    # Create DataFrame
    importance_df = pd.DataFrame({
        'feature': feature_names,
        'importance': importance
    }).sort_values('importance', ascending=False)

    # Calculate cumulative importance
    importance_df['cumulative'] = importance_df['importance'].cumsum()
    importance_df['rank'] = range(1, len(importance_df) + 1)

    # Print top features
    print("\n   Top 15 Most Important Features:")
    print("   " + "-" * 45)
    for i, row in importance_df.head(15).iterrows():
        bar = "█" * int(row['importance'] * 50)
        print(f"   {row['rank']:2d}. {row['feature']:20s} {row['importance']:.4f} {bar}")

    # Features that explain 80% of variance
    top_80 = importance_df[importance_df['cumulative'] <= 0.8]
    print(f"\n   Features explaining 80% of predictions: {len(top_80)}")

    # Bottom features (potentially removable)
    bottom_features = importance_df[importance_df['importance'] < 0.01]
    if len(bottom_features) > 0:
        print(f"\n   ⚠️  Low importance features (<1%): {list(bottom_features['feature'])}")

    return importance_df


def analyze_feature_correlations(X: pd.DataFrame, y: pd.Series) -> pd.DataFrame:
    """Analyze correlations between features and target."""
    print("\n🔗 Feature-Target Correlations:")
    print("=" * 50)

    # Calculate point-biserial correlations
    correlations = []
    for col in X.columns:
        corr = X[col].corr(y)
        correlations.append({'feature': col, 'correlation': corr})

    corr_df = pd.DataFrame(correlations).sort_values('correlation', key=abs, ascending=False)

    print("\n   Top 10 Correlated Features (with target):")
    print("   " + "-" * 45)
    for i, row in corr_df.head(10).iterrows():
        direction = "+" if row['correlation'] > 0 else "-"
        bar_len = int(abs(row['correlation']) * 30)
        bar = "█" * bar_len
        print(f"   {row['feature']:20s} {direction}{abs(row['correlation']):.4f} {bar}")

    return corr_df


# =============================================================================
# INSIGHTS GENERATION
# =============================================================================

def generate_insights(
    model,
    X: pd.DataFrame,
    y: pd.Series,
    importance_df: pd.DataFrame,
    corr_df: pd.DataFrame,
    metrics: dict
) -> dict:
    """Generate actionable insights from the analysis."""
    print("\n💡 KEY INSIGHTS & RECOMMENDATIONS:")
    print("=" * 60)

    insights = {
        'model_quality': '',
        'top_features': [],
        'regime_insights': {},
        'time_insights': {},
        'indicator_insights': {},
        'recommendations': []
    }

    # 1. Model Quality Assessment
    auc = metrics.get('roc_auc', 0)
    if auc > 0.7:
        quality = "GOOD - The model has predictive power"
        insights['model_quality'] = 'good'
    elif auc > 0.6:
        quality = "MODERATE - Some signal, but noisy"
        insights['model_quality'] = 'moderate'
    else:
        quality = "POOR - Features may not be predictive"
        insights['model_quality'] = 'poor'

    print(f"\n1️⃣  Model Quality: {quality}")
    print(f"    ROC AUC = {auc:.3f} (0.5 = random, 1.0 = perfect)")

    # 2. Top Predictive Features
    top_features = importance_df.head(5)['feature'].tolist()
    insights['top_features'] = top_features
    print(f"\n2️⃣  Most Predictive Features: {', '.join(top_features)}")

    # 3. Regime Analysis
    if 'regimeEncoded' in X.columns:
        print("\n3️⃣  Regime Analysis:")
        regime_map = {2: 'BULLISH', 1: 'RANGE', 0: 'BEARISH'}
        for regime_code, regime_name in regime_map.items():
            mask = X['regimeEncoded'] == regime_code
            if mask.sum() > 0:
                win_rate = y[mask].mean() * 100
                insights['regime_insights'][regime_name] = win_rate
                indicator = "✅" if win_rate > 50 else "❌"
                print(f"    {indicator} {regime_name}: {win_rate:.1f}% win rate ({mask.sum()} trades)")

    # 4. Time Analysis (for synthetic indices - 24/7 market)
    if 'hourOfDay' in X.columns:
        print("\n4️⃣  Time-of-Day Analysis (Synthetic Indices - 24/7):")
        # Group hours into 6-hour blocks for synthetic indices
        time_blocks = {
            '00-06h': (0, 6),
            '06-12h': (6, 12),
            '12-18h': (12, 18),
            '18-24h': (18, 24)
        }
        for block_name, (start, end) in time_blocks.items():
            mask = (X['hourOfDay'] >= start) & (X['hourOfDay'] < end)
            if mask.sum() > 0:
                win_rate = y[mask].mean() * 100
                insights['time_insights'][block_name] = win_rate
                indicator = "✅" if win_rate > 50 else "❌"
                print(f"    {indicator} {block_name}: {win_rate:.1f}% win rate ({mask.sum()} trades)")

    # 5. Indicator Insights
    print("\n5️⃣  Indicator Insights:")

    # RSI zones
    if 'rsi1m' in X.columns:
        rsi_oversold = y[X['rsi1m'] < 30].mean() * 100 if (X['rsi1m'] < 30).sum() > 0 else 0
        rsi_overbought = y[X['rsi1m'] > 70].mean() * 100 if (X['rsi1m'] > 70).sum() > 0 else 0
        rsi_neutral = y[(X['rsi1m'] >= 30) & (X['rsi1m'] <= 70)].mean() * 100

        insights['indicator_insights']['rsi_oversold_winrate'] = rsi_oversold
        insights['indicator_insights']['rsi_overbought_winrate'] = rsi_overbought

        print(f"    RSI < 30 (oversold):  {rsi_oversold:.1f}% win rate")
        print(f"    RSI > 70 (overbought): {rsi_overbought:.1f}% win rate")
        print(f"    RSI 30-70 (neutral):  {rsi_neutral:.1f}% win rate")

    # BB position
    if 'pricePositionInBB' in X.columns:
        bb_low = y[X['pricePositionInBB'] < -0.5].mean() * 100 if (X['pricePositionInBB'] < -0.5).sum() > 0 else 0
        bb_high = y[X['pricePositionInBB'] > 0.5].mean() * 100 if (X['pricePositionInBB'] > 0.5).sum() > 0 else 0

        insights['indicator_insights']['bb_low_winrate'] = bb_low
        insights['indicator_insights']['bb_high_winrate'] = bb_high

        print(f"    Price near lower BB:  {bb_low:.1f}% win rate")
        print(f"    Price near upper BB:  {bb_high:.1f}% win rate")

    # 6. Strategy Type Analysis
    if 'strategyEncoded' in X.columns:
        print("\n6️⃣  Strategy Type Analysis:")
        strategy_map = {1: 'MOMENTUM', 0: 'MEAN_REVERSION'}
        for code, name in strategy_map.items():
            mask = X['strategyEncoded'] == code
            if mask.sum() > 0:
                win_rate = y[mask].mean() * 100
                insights['indicator_insights'][f'{name}_winrate'] = win_rate
                indicator = "✅" if win_rate > 50 else "❌"
                print(f"    {indicator} {name}: {win_rate:.1f}% win rate ({mask.sum()} trades)")

    # 7. Volatility Analysis (BB Width)
    if 'bbWidthPct' in X.columns:
        print("\n7️⃣  Volatility Analysis (BB Width):")
        # Divide into terciles
        low_vol = X['bbWidthPct'].quantile(0.33)
        high_vol = X['bbWidthPct'].quantile(0.67)

        low_mask = X['bbWidthPct'] <= low_vol
        mid_mask = (X['bbWidthPct'] > low_vol) & (X['bbWidthPct'] <= high_vol)
        high_mask = X['bbWidthPct'] > high_vol

        for name, mask in [('Low volatility', low_mask), ('Medium volatility', mid_mask), ('High volatility', high_mask)]:
            if mask.sum() > 0:
                win_rate = y[mask].mean() * 100
                indicator = "✅" if win_rate > 50 else "❌"
                print(f"    {indicator} {name}: {win_rate:.1f}% win rate ({mask.sum()} trades)")
                insights['indicator_insights'][f'{name.lower().replace(" ", "_")}_winrate'] = win_rate

    # 8. ADX Strength Analysis
    if 'adx15m' in X.columns:
        print("\n8️⃣  ADX Trend Strength Analysis:")
        weak_trend = X['adx15m'] < 20
        moderate_trend = (X['adx15m'] >= 20) & (X['adx15m'] < 40)
        strong_trend = X['adx15m'] >= 40

        for name, mask in [('Weak (ADX<20)', weak_trend), ('Moderate (20-40)', moderate_trend), ('Strong (ADX>40)', strong_trend)]:
            if mask.sum() > 0:
                win_rate = y[mask].mean() * 100
                indicator = "✅" if win_rate > 50 else "❌"
                print(f"    {indicator} {name}: {win_rate:.1f}% win rate ({mask.sum()} trades)")

    # 9. Recommendations
    print("\n9️⃣  Recommendations:")

    recommendations = []

    # Based on regime
    if insights['regime_insights']:
        best_regime = max(insights['regime_insights'], key=insights['regime_insights'].get)
        worst_regime = min(insights['regime_insights'], key=insights['regime_insights'].get)
        if insights['regime_insights'][worst_regime] < 40:
            rec = f"Consider DISABLING trades in {worst_regime} regime"
            recommendations.append(rec)
            print(f"    • {rec}")

    # Based on time
    if insights['time_insights']:
        best_time = max(insights['time_insights'], key=insights['time_insights'].get)
        worst_time = min(insights['time_insights'], key=insights['time_insights'].get)
        if insights['time_insights'][worst_time] < 35:
            rec = f"Consider AVOIDING {worst_time} block"
            recommendations.append(rec)
            print(f"    • {rec}")

    # Based on model quality
    if auc < 0.6:
        rec = "Add more features or collect more data - current features have low predictive power"
        recommendations.append(rec)
        print(f"    • {rec}")

    # Low importance features
    low_importance = importance_df[importance_df['importance'] < 0.01]['feature'].tolist()
    if low_importance:
        rec = f"Consider removing low-impact features: {', '.join(low_importance[:3])}"
        recommendations.append(rec)
        print(f"    • {rec}")

    insights['recommendations'] = recommendations

    return insights


# =============================================================================
# VISUALIZATION
# =============================================================================

def plot_results(
    model,
    X_test,
    y_test,
    importance_df: pd.DataFrame,
    output_dir: str = 'analysis-output'
):
    """Generate visualization charts."""
    if not HAS_PLOTTING:
        print("\n⚠️  Skipping charts (matplotlib not installed)")
        return

    print("\n📊 Generating Charts...")

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))

    # 1. Feature Importance
    ax1 = axes[0, 0]
    top_n = min(15, len(importance_df))
    top_features = importance_df.head(top_n)
    colors = plt.cm.Blues(np.linspace(0.3, 0.9, top_n))[::-1]
    ax1.barh(range(top_n), top_features['importance'].values, color=colors)
    ax1.set_yticks(range(top_n))
    ax1.set_yticklabels(top_features['feature'].values)
    ax1.invert_yaxis()
    ax1.set_xlabel('Importance')
    ax1.set_title('Top Feature Importance')

    # 2. ROC Curve
    ax2 = axes[0, 1]
    y_pred_proba = model.predict_proba(X_test)[:, 1]
    fpr, tpr, _ = roc_curve(y_test, y_pred_proba)
    roc_auc = roc_auc_score(y_test, y_pred_proba)
    ax2.plot(fpr, tpr, 'b-', label=f'ROC (AUC = {roc_auc:.3f})')
    ax2.plot([0, 1], [0, 1], 'r--', label='Random')
    ax2.set_xlabel('False Positive Rate')
    ax2.set_ylabel('True Positive Rate')
    ax2.set_title('ROC Curve')
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    # 3. Confusion Matrix
    ax3 = axes[1, 0]
    y_pred = model.predict(X_test)
    cm = confusion_matrix(y_test, y_pred)
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', ax=ax3,
                xticklabels=['LOSS', 'WIN'], yticklabels=['LOSS', 'WIN'])
    ax3.set_xlabel('Predicted')
    ax3.set_ylabel('Actual')
    ax3.set_title('Confusion Matrix')

    # 4. Prediction Distribution
    ax4 = axes[1, 1]
    ax4.hist(y_pred_proba[y_test == 0], bins=30, alpha=0.5, label='Actual LOSS', color='red')
    ax4.hist(y_pred_proba[y_test == 1], bins=30, alpha=0.5, label='Actual WIN', color='green')
    ax4.axvline(x=0.5, color='black', linestyle='--', label='Decision Boundary')
    ax4.set_xlabel('Predicted Probability of WIN')
    ax4.set_ylabel('Frequency')
    ax4.set_title('Prediction Distribution')
    ax4.legend()

    plt.tight_layout()

    # Save
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filepath = os.path.join(output_dir, f'ml_analysis_{timestamp}.png')
    plt.savefig(filepath, dpi=150, bbox_inches='tight')
    print(f"   Chart saved to: {filepath}")

    plt.close()


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 60)
    print("🤖 XGBoost Trade Prediction Model")
    print("=" * 60)

    # Get CSV file
    if len(sys.argv) > 1:
        csv_file = sys.argv[1]
    else:
        try:
            csv_file = find_latest_csv()
        except FileNotFoundError as e:
            print(f"\n❌ Error: {e}")
            print("Run backtest with ML collection first:")
            print("  ASSET='R_100' DAYS='90' npx tsx src/scripts/backtest-hybrid-ml-collect.ts")
            sys.exit(1)

    # Load data
    df = load_data(csv_file)

    # Prepare features
    X, y, feature_names = prepare_features(df)

    # Split data
    print(f"\n📦 Splitting data (80% train, 20% test)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"   Train: {len(X_train)} samples")
    print(f"   Test:  {len(X_test)} samples")

    # Train model
    model = train_model(X_train, y_train, X_test, y_test)

    # Evaluate
    metrics = evaluate_model(model, X_test, y_test, feature_names)

    # Cross-validation
    cv_results = cross_validate(model, X, y, cv=5)

    # Feature importance
    importance_df = analyze_feature_importance(model, feature_names)

    # Correlations
    corr_df = analyze_feature_correlations(X, y)

    # Generate insights
    insights = generate_insights(model, X, y, importance_df, corr_df, metrics)

    # Plot results
    plot_results(model, X_test, y_test, importance_df)

    # Save results
    output_dir = 'analysis-output'
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    results = {
        'timestamp': timestamp,
        'data_file': csv_file,
        'samples': len(df),
        'features_used': feature_names,
        'metrics': metrics,
        'cv_results': cv_results,
        'feature_importance': importance_df.to_dict('records'),
        'correlations': corr_df.to_dict('records'),
        'insights': insights
    }

    results_file = os.path.join(output_dir, f'ml_results_{timestamp}.json')
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n💾 Results saved to: {results_file}")

    print("\n" + "=" * 60)
    print("✅ Analysis Complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()
