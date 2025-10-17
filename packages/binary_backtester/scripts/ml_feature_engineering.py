#!/usr/bin/env python3
"""
Feature Engineering for ML Trading Model
Transforms R_75 OHLC data into ML-ready features
"""
import json
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime
from typing import Tuple
from sklearn.preprocessing import MinMaxScaler
import sys

# Technical Analysis
try:
    import talib
    HAS_TALIB = True
except ImportError:
    HAS_TALIB = False
    print("⚠️  TA-Lib not available, using manual indicators")


class MLFeatureEngineer:
    """Feature engineering for ML binary options trading"""

    def __init__(self, prediction_horizon: int = 3):
        """
        Initialize feature engineer

        Args:
            prediction_horizon: Minutes ahead to predict (default: 3)
        """
        self.prediction_horizon = prediction_horizon
        self.scaler = MinMaxScaler()
        self.feature_columns = []

    def load_data(self, filepath: str) -> pd.DataFrame:
        """Load candle data and convert to DataFrame"""
        print(f"📂 Loading data from {Path(filepath).name}")

        with open(filepath, 'r') as f:
            data = json.load(f)

        candles = data if isinstance(data, list) else data.get('candles', data)

        df = pd.DataFrame(candles)
        df.rename(columns={'epoch': 'timestamp'}, inplace=True)

        # Convert timestamp to datetime
        df['datetime'] = pd.to_datetime(df['timestamp'], unit='s')

        print(f"✅ Loaded {len(df):,} candles")
        print(f"   Date range: {df['datetime'].min()} to {df['datetime'].max()}")

        return df

    def clean_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Clean data: remove gaps, missing values, validate OHLC
        """
        print("\n🧹 Cleaning data...")

        initial_count = len(df)

        # Remove duplicates
        df = df.drop_duplicates(subset=['timestamp'])

        # Check for missing OHLC
        required_cols = ['open', 'high', 'low', 'close']
        df = df.dropna(subset=required_cols)

        # Validate OHLC relationships
        valid_ohlc = (
            (df['high'] >= df['open']) &
            (df['high'] >= df['close']) &
            (df['low'] <= df['open']) &
            (df['low'] <= df['close']) &
            (df['high'] >= df['low'])
        )
        df = df[valid_ohlc]

        # Sort by timestamp
        df = df.sort_values('timestamp').reset_index(drop=True)

        removed = initial_count - len(df)
        print(f"✅ Cleaned: {len(df):,} candles ({removed} removed, {removed/initial_count*100:.2f}%)")

        return df

    def create_target(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Create binary target variable:
        1 (CALL) if close[t + horizon] > close[t]
        0 (PUT) otherwise
        """
        print(f"\n🎯 Creating target variable (horizon: {self.prediction_horizon} minutes)...")

        # Calculate future price
        df['future_close'] = df['close'].shift(-self.prediction_horizon)

        # Create binary target
        df['target'] = (df['future_close'] > df['close']).astype(int)

        # Remove rows without future data
        df = df[df['future_close'].notna()].copy()

        # Calculate class balance
        call_pct = (df['target'] == 1).sum() / len(df) * 100
        put_pct = (df['target'] == 0).sum() / len(df) * 100

        print(f"✅ Target created:")
        print(f"   CALL (1): {call_pct:.2f}%")
        print(f"   PUT (0): {put_pct:.2f}%")

        if abs(call_pct - 50) > 10:
            print(f"⚠️  Class imbalance detected! Consider SMOTE or class weights")

        return df

    def engineer_price_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create price-based features: lags, returns, etc."""
        print("\n💰 Engineering price features...")

        # Price lags (last 5 candles)
        for lag in range(1, 6):
            df[f'close_lag_{lag}'] = df['close'].shift(lag)
            df[f'open_lag_{lag}'] = df['open'].shift(lag)

        # Returns (percentage change)
        df['return_1'] = df['close'].pct_change(1)
        df['return_3'] = df['close'].pct_change(3)
        df['return_5'] = df['close'].pct_change(5)

        # Price position relative to open
        df['close_vs_open'] = (df['close'] - df['open']) / df['open']

        # Candle range
        df['high_low_range'] = (df['high'] - df['low']) / df['low']

        # Body size (open-close distance)
        df['body_size'] = abs(df['close'] - df['open']) / df['open']

        print(f"✅ Created {10 + 5*2} price features")
        return df

    def engineer_technical_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create technical indicator features"""
        print("\n📊 Engineering technical indicators...")

        close = df['close'].values
        high = df['high'].values
        low = df['low'].values

        if HAS_TALIB:
            # RSI
            df['rsi'] = talib.RSI(close, timeperiod=14)

            # MACD
            macd, signal, hist = talib.MACD(close, fastperiod=12, slowperiod=26, signalperiod=9)
            df['macd'] = macd
            df['macd_signal'] = signal
            df['macd_hist'] = hist

            # Bollinger Bands
            upper, middle, lower = talib.BBANDS(close, timeperiod=20, nbdevup=2, nbdevdn=2)
            df['bb_upper'] = upper
            df['bb_middle'] = middle
            df['bb_lower'] = lower
            df['bb_width'] = (upper - lower) / middle
            df['bb_position'] = (close - lower) / (upper - lower)  # %B

            # ATR
            df['atr'] = talib.ATR(high, low, close, timeperiod=14)
            df['atr_normalized'] = df['atr'] / df['close']

            print(f"✅ Created 12 TA-Lib indicators")
        else:
            # Manual RSI
            delta = pd.Series(close).diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            rs = gain / loss
            df['rsi'] = 100 - (100 / (1 + rs))

            # Simple moving averages
            df['sma_10'] = df['close'].rolling(window=10).mean()
            df['sma_20'] = df['close'].rolling(window=20).mean()

            # ATR manual
            hl = high - low
            hc = abs(high - pd.Series(close).shift(1))
            lc = abs(low - pd.Series(close).shift(1))
            tr = pd.concat([pd.Series(hl), hc, lc], axis=1).max(axis=1)
            df['atr'] = tr.rolling(window=14).mean()
            df['atr_normalized'] = df['atr'] / df['close']

            print(f"✅ Created 5 manual indicators (install TA-Lib for more)")

        return df

    def engineer_time_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create time-based features"""
        print("\n⏰ Engineering time features...")

        df['hour'] = df['datetime'].dt.hour
        df['day_of_week'] = df['datetime'].dt.dayofweek
        df['minute'] = df['datetime'].dt.minute

        # Cyclical encoding for hour (0-23)
        df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
        df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)

        # Cyclical encoding for day of week (0-6)
        df['day_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
        df['day_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)

        print(f"✅ Created 8 time features")
        return df

    def create_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create all features"""
        print("\n🔧 FEATURE ENGINEERING PIPELINE")
        print("=" * 70)

        # Clean data
        df = self.clean_data(df)

        # Create target
        df = self.create_target(df)

        # Engineer features
        df = self.engineer_price_features(df)
        df = self.engineer_technical_indicators(df)
        df = self.engineer_time_features(df)

        # Drop rows with NaN (from lags and indicators)
        initial_count = len(df)
        df = df.dropna()
        dropped = initial_count - len(df)

        print(f"\n✅ Final dataset: {len(df):,} samples ({dropped} dropped due to NaN)")

        # Identify feature columns (exclude metadata)
        exclude_cols = ['timestamp', 'datetime', 'future_close', 'target', 'open', 'high', 'low', 'close']
        self.feature_columns = [col for col in df.columns if col not in exclude_cols]

        print(f"✅ Total features: {len(self.feature_columns)}")
        print(f"\n📋 Feature list:")
        for i, col in enumerate(self.feature_columns, 1):
            print(f"   {i}. {col}")

        return df

    def split_dataset(
        self,
        df: pd.DataFrame,
        train_size: float = 0.7,
        val_size: float = 0.15
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """
        Split dataset into train/val/test (time-ordered, no shuffle)
        """
        print(f"\n✂️  Splitting dataset ({train_size*100:.0f}% train, {val_size*100:.0f}% val, {(1-train_size-val_size)*100:.0f}% test)...")

        n = len(df)
        train_end = int(n * train_size)
        val_end = int(n * (train_size + val_size))

        train_df = df.iloc[:train_end].copy()
        val_df = df.iloc[train_end:val_end].copy()
        test_df = df.iloc[val_end:].copy()

        print(f"✅ Train: {len(train_df):,} samples ({train_df['datetime'].min()} to {train_df['datetime'].max()})")
        print(f"✅ Val:   {len(val_df):,} samples ({val_df['datetime'].min()} to {val_df['datetime'].max()})")
        print(f"✅ Test:  {len(test_df):,} samples ({test_df['datetime'].min()} to {test_df['datetime'].max()})")

        # Check class balance in each split
        for name, split_df in [('Train', train_df), ('Val', val_df), ('Test', test_df)]:
            call_pct = (split_df['target'] == 1).sum() / len(split_df) * 100
            print(f"   {name} CALL: {call_pct:.2f}%")

        return train_df, val_df, test_df

    def normalize_features(
        self,
        train_df: pd.DataFrame,
        val_df: pd.DataFrame,
        test_df: pd.DataFrame
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """
        Normalize features using MinMaxScaler
        Fit on train, transform train/val/test
        """
        print("\n📏 Normalizing features (MinMaxScaler)...")

        # Fit scaler on training data only
        self.scaler.fit(train_df[self.feature_columns])

        # Transform all splits
        train_df[self.feature_columns] = self.scaler.transform(train_df[self.feature_columns])
        val_df[self.feature_columns] = self.scaler.transform(val_df[self.feature_columns])
        test_df[self.feature_columns] = self.scaler.transform(test_df[self.feature_columns])

        print(f"✅ Normalized {len(self.feature_columns)} features")
        print(f"   Feature range: [0, 1] (MinMax)")

        return train_df, val_df, test_df

    def save_datasets(
        self,
        train_df: pd.DataFrame,
        val_df: pd.DataFrame,
        test_df: pd.DataFrame,
        output_dir: Path
    ):
        """Save processed datasets to files"""
        print(f"\n💾 Saving datasets to {output_dir}...")

        output_dir.mkdir(exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        # Save as Parquet (efficient for ML)
        train_file = output_dir / f'train_{timestamp}.parquet'
        val_file = output_dir / f'val_{timestamp}.parquet'
        test_file = output_dir / f'test_{timestamp}.parquet'

        train_df.to_parquet(train_file, index=False)
        val_df.to_parquet(val_file, index=False)
        test_df.to_parquet(test_file, index=False)

        print(f"✅ Train: {train_file.name} ({train_file.stat().st_size / 1024 / 1024:.2f} MB)")
        print(f"✅ Val:   {val_file.name} ({val_file.stat().st_size / 1024 / 1024:.2f} MB)")
        print(f"✅ Test:  {test_file.name} ({test_file.stat().st_size / 1024 / 1024:.2f} MB)")

        # Save feature list and scaler
        metadata = {
            'feature_columns': self.feature_columns,
            'prediction_horizon': self.prediction_horizon,
            'train_samples': len(train_df),
            'val_samples': len(val_df),
            'test_samples': len(test_df),
            'train_file': str(train_file),
            'val_file': str(val_file),
            'test_file': str(test_file),
            'created_at': datetime.now().isoformat()
        }

        metadata_file = output_dir / f'metadata_{timestamp}.json'
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)

        print(f"✅ Metadata: {metadata_file.name}")

        return {
            'train': str(train_file),
            'val': str(val_file),
            'test': str(test_file),
            'metadata': str(metadata_file)
        }


def main():
    """Main pipeline"""
    print("🎯 ML FEATURE ENGINEERING PIPELINE")
    print("=" * 70)

    # Find latest R_75 data file
    data_dir = Path(__file__).parent.parent / 'data'
    r75_files = sorted(data_dir.glob('deriv_candles_R_75_*.json'), key=lambda p: p.stat().st_mtime, reverse=True)

    if not r75_files:
        print("❌ No R_75 data files found in data/")
        print("   Run: python scripts/fetch_deriv_r75_data.py --days 90")
        return 1

    input_file = r75_files[0]
    print(f"📂 Input: {input_file.name}")
    print()

    # Initialize engineer
    engineer = MLFeatureEngineer(prediction_horizon=3)

    # Load data
    df = engineer.load_data(input_file)

    # Create features
    df = engineer.create_features(df)

    # Split dataset
    train_df, val_df, test_df = engineer.split_dataset(df)

    # Normalize
    train_df, val_df, test_df = engineer.normalize_features(train_df, val_df, test_df)

    # Save
    ml_data_dir = Path(__file__).parent.parent / 'ml_data'
    files = engineer.save_datasets(train_df, val_df, test_df, ml_data_dir)

    print("\n" + "=" * 70)
    print("✅ FEATURE ENGINEERING COMPLETE!")
    print("=" * 70)
    print("\n🎯 Next steps:")
    print("   1. Train LSTM model: python scripts/ml_train_model.py")
    print("   2. Check correlation: python scripts/ml_validate_features.py")
    print()

    return 0


if __name__ == '__main__':
    sys.exit(main())
