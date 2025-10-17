#!/usr/bin/env python3
"""
LSTM Model Training for Binary Options Prediction
Train LSTM on engineered features to predict CALL/PUT
"""
import json
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from pathlib import Path
from datetime import datetime
import sys


class BinaryOptionsDataset(Dataset):
    """PyTorch Dataset for binary options sequences"""

    def __init__(self, df: pd.DataFrame, feature_columns: list, seq_len: int = 20):
        """
        Args:
            df: DataFrame with features and target
            feature_columns: List of feature column names
            seq_len: Sequence length (number of past candles to use)
        """
        self.feature_columns = feature_columns
        self.seq_len = seq_len

        # Extract features and target
        self.features = df[feature_columns].values
        self.targets = df['target'].values

        # Create sequences
        self.sequences = []
        self.labels = []

        for i in range(len(df) - seq_len):
            seq = self.features[i:i + seq_len]
            label = self.targets[i + seq_len]
            self.sequences.append(seq)
            self.labels.append(label)

        self.sequences = np.array(self.sequences, dtype=np.float32)
        self.labels = np.array(self.labels, dtype=np.int64)

    def __len__(self):
        return len(self.sequences)

    def __getitem__(self, idx):
        return torch.tensor(self.sequences[idx]), torch.tensor(self.labels[idx])


class LSTMModel(nn.Module):
    """LSTM model for binary classification"""

    def __init__(self, input_size: int, hidden_size: int = 50, num_layers: int = 2, dropout: float = 0.2):
        """
        Args:
            input_size: Number of features
            hidden_size: Number of LSTM units per layer
            num_layers: Number of LSTM layers
            dropout: Dropout rate
        """
        super(LSTMModel, self).__init__()

        self.hidden_size = hidden_size
        self.num_layers = num_layers

        # LSTM layers
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0
        )

        # Fully connected layers
        self.fc1 = nn.Linear(hidden_size, 32)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(dropout)
        self.fc2 = nn.Linear(32, 2)  # 2 classes: PUT (0), CALL (1)

    def forward(self, x):
        # LSTM forward pass
        lstm_out, (h_n, c_n) = self.lstm(x)

        # Take output from last time step
        last_output = lstm_out[:, -1, :]

        # Fully connected layers
        out = self.fc1(last_output)
        out = self.relu(out)
        out = self.dropout(out)
        out = self.fc2(out)

        return out


class LSTMTrainer:
    """Train and evaluate LSTM model"""

    def __init__(
        self,
        model: nn.Module,
        device: str = 'cpu',
        learning_rate: float = 0.001,
        patience: int = 5
    ):
        self.model = model.to(device)
        self.device = device
        self.patience = patience

        # Loss and optimizer
        self.criterion = nn.CrossEntropyLoss()
        self.optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

        # Training history
        self.train_losses = []
        self.val_losses = []
        self.train_accuracies = []
        self.val_accuracies = []

    def train_epoch(self, train_loader: DataLoader) -> tuple:
        """Train for one epoch"""
        self.model.train()

        total_loss = 0
        correct = 0
        total = 0

        for sequences, labels in train_loader:
            sequences = sequences.to(self.device)
            labels = labels.to(self.device)

            # Forward pass
            outputs = self.model(sequences)
            loss = self.criterion(outputs, labels)

            # Backward pass
            self.optimizer.zero_grad()
            loss.backward()
            self.optimizer.step()

            # Statistics
            total_loss += loss.item()
            _, predicted = torch.max(outputs.data, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()

        avg_loss = total_loss / len(train_loader)
        accuracy = correct / total

        return avg_loss, accuracy

    def evaluate(self, data_loader: DataLoader) -> tuple:
        """Evaluate model"""
        self.model.eval()

        total_loss = 0
        correct = 0
        total = 0
        all_predictions = []
        all_labels = []

        with torch.no_grad():
            for sequences, labels in data_loader:
                sequences = sequences.to(self.device)
                labels = labels.to(self.device)

                outputs = self.model(sequences)
                loss = self.criterion(outputs, labels)

                total_loss += loss.item()
                _, predicted = torch.max(outputs.data, 1)
                total += labels.size(0)
                correct += (predicted == labels).sum().item()

                all_predictions.extend(predicted.cpu().numpy())
                all_labels.extend(labels.cpu().numpy())

        avg_loss = total_loss / len(data_loader)
        accuracy = correct / total

        return avg_loss, accuracy, np.array(all_predictions), np.array(all_labels)

    def train(
        self,
        train_loader: DataLoader,
        val_loader: DataLoader,
        epochs: int = 50
    ):
        """Train model with early stopping"""
        print(f"\n🚀 Starting LSTM training...")
        print(f"   Epochs: {epochs}")
        print(f"   Device: {self.device}")
        print(f"   Patience: {self.patience}")
        print()

        best_val_loss = float('inf')
        patience_counter = 0
        best_epoch = 0

        for epoch in range(epochs):
            # Train
            train_loss, train_acc = self.train_epoch(train_loader)

            # Validate
            val_loss, val_acc, _, _ = self.evaluate(val_loader)

            # Save history
            self.train_losses.append(train_loss)
            self.val_losses.append(val_loss)
            self.train_accuracies.append(train_acc)
            self.val_accuracies.append(val_acc)

            # Print progress
            print(f"Epoch {epoch + 1:3d}/{epochs} | "
                  f"Train Loss: {train_loss:.4f} Acc: {train_acc:.4f} | "
                  f"Val Loss: {val_loss:.4f} Acc: {val_acc:.4f}", end='')

            # Early stopping
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_epoch = epoch + 1
                patience_counter = 0
                print(" ✅ Best!")
                # Save best model
                torch.save(self.model.state_dict(), 'best_model.pth')
            else:
                patience_counter += 1
                print(f" (patience: {patience_counter}/{self.patience})")

                if patience_counter >= self.patience:
                    print(f"\n⚠️  Early stopping at epoch {epoch + 1}")
                    print(f"   Best epoch was {best_epoch}")
                    break

        # Load best model
        self.model.load_state_dict(torch.load('best_model.pth'))
        print(f"\n✅ Training complete! Best model from epoch {best_epoch}")


def load_latest_dataset():
    """Load latest ML dataset"""
    ml_data_dir = Path(__file__).parent.parent / 'ml_data'
    metadata_files = sorted(ml_data_dir.glob('metadata_*.json'), key=lambda p: p.stat().st_mtime, reverse=True)

    if not metadata_files:
        print("❌ No ML datasets found")
        return None

    with open(metadata_files[0], 'r') as f:
        metadata = json.load(f)

    train_df = pd.read_parquet(metadata['train_file'])
    val_df = pd.read_parquet(metadata['val_file'])
    test_df = pd.read_parquet(metadata['test_file'])

    return train_df, val_df, test_df, metadata


def main():
    """Main training pipeline"""
    print("🎯 LSTM MODEL TRAINING")
    print("=" * 70)

    # Hyperparameters
    SEQ_LEN = 20
    HIDDEN_SIZE = 50
    NUM_LAYERS = 2
    DROPOUT = 0.2
    BATCH_SIZE = 64
    LEARNING_RATE = 0.001
    EPOCHS = 50
    PATIENCE = 5

    print(f"\n📋 Hyperparameters:")
    print(f"   Sequence Length: {SEQ_LEN}")
    print(f"   Hidden Size: {HIDDEN_SIZE}")
    print(f"   Num Layers: {NUM_LAYERS}")
    print(f"   Dropout: {DROPOUT}")
    print(f"   Batch Size: {BATCH_SIZE}")
    print(f"   Learning Rate: {LEARNING_RATE}")
    print(f"   Max Epochs: {EPOCHS}")
    print(f"   Patience: {PATIENCE}")

    # Load dataset
    result = load_latest_dataset()
    if result is None:
        return 1

    train_df, val_df, test_df, metadata = result
    feature_columns = metadata['feature_columns']

    print(f"\n✅ Loaded datasets:")
    print(f"   Train: {len(train_df):,} samples")
    print(f"   Val: {len(val_df):,} samples")
    print(f"   Test: {len(test_df):,} samples")
    print(f"   Features: {len(feature_columns)}")

    # Create datasets
    print(f"\n🔄 Creating sequence datasets (seq_len={SEQ_LEN})...")
    train_dataset = BinaryOptionsDataset(train_df, feature_columns, seq_len=SEQ_LEN)
    val_dataset = BinaryOptionsDataset(val_df, feature_columns, seq_len=SEQ_LEN)
    test_dataset = BinaryOptionsDataset(test_df, feature_columns, seq_len=SEQ_LEN)

    print(f"✅ Sequences created:")
    print(f"   Train: {len(train_dataset):,} sequences")
    print(f"   Val: {len(val_dataset):,} sequences")
    print(f"   Test: {len(test_dataset):,} sequences")

    # Create data loaders
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False)
    test_loader = DataLoader(test_dataset, batch_size=BATCH_SIZE, shuffle=False)

    # Initialize model
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"\n🔧 Initializing LSTM model...")
    print(f"   Device: {device}")

    model = LSTMModel(
        input_size=len(feature_columns),
        hidden_size=HIDDEN_SIZE,
        num_layers=NUM_LAYERS,
        dropout=DROPOUT
    )

    print(f"✅ Model initialized:")
    print(f"   Parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Train model
    trainer = LSTMTrainer(model, device=device, learning_rate=LEARNING_RATE, patience=PATIENCE)
    trainer.train(train_loader, val_loader, epochs=EPOCHS)

    # Final evaluation
    print("\n" + "=" * 70)
    print("📊 FINAL EVALUATION")
    print("=" * 70)

    for split_name, loader in [('Train', train_loader), ('Val', val_loader), ('Test', test_loader)]:
        loss, accuracy, predictions, labels = trainer.evaluate(loader)

        # Calculate metrics
        tp = ((predictions == 1) & (labels == 1)).sum()
        tn = ((predictions == 0) & (labels == 0)).sum()
        fp = ((predictions == 1) & (labels == 0)).sum()
        fn = ((predictions == 0) & (labels == 1)).sum()

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        print(f"\n{split_name}:")
        print(f"   Loss: {loss:.4f}")
        print(f"   Accuracy: {accuracy:.4f} ({accuracy * 100:.2f}%)")
        print(f"   Precision (CALL): {precision:.4f}")
        print(f"   Recall (CALL): {recall:.4f}")
        print(f"   F1 Score: {f1:.4f}")

    # Save model and results
    print("\n💾 Saving model and results...")

    output_dir = Path(__file__).parent.parent / 'ml_models'
    output_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # Save model
    model_file = output_dir / f'lstm_model_{timestamp}.pth'
    torch.save(model.state_dict(), model_file)
    print(f"✅ Model saved: {model_file.name}")

    # Save training history
    history = {
        'hyperparameters': {
            'seq_len': SEQ_LEN,
            'hidden_size': HIDDEN_SIZE,
            'num_layers': NUM_LAYERS,
            'dropout': DROPOUT,
            'batch_size': BATCH_SIZE,
            'learning_rate': LEARNING_RATE,
            'epochs': EPOCHS
        },
        'train_losses': trainer.train_losses,
        'val_losses': trainer.val_losses,
        'train_accuracies': trainer.train_accuracies,
        'val_accuracies': trainer.val_accuracies,
        'final_metrics': {
            'train_accuracy': trainer.train_accuracies[-1],
            'val_accuracy': trainer.val_accuracies[-1]
        }
    }

    history_file = output_dir / f'training_history_{timestamp}.json'
    with open(history_file, 'w') as f:
        json.dump(history, f, indent=2)
    print(f"✅ History saved: {history_file.name}")

    # Assessment
    print("\n" + "=" * 70)
    print("🎯 ASSESSMENT")
    print("=" * 70)

    test_loss, test_acc, _, _ = trainer.evaluate(test_loader)

    if test_acc > 0.55:
        print("\n✅ SUCCESS! Test accuracy >55%")
        print("   LSTM shows strong predictive power!")
        print("   Recommendations:")
        print("   - Proceed to hyperparameter tuning")
        print("   - Try ensemble methods")
        print("   - Ready for bot integration (Fase 3)")
    elif test_acc > 0.52:
        print("\n⚠️  MARGINAL. Test accuracy 52-55%")
        print("   LSTM shows some signal but limited.")
        print("   Recommendations:")
        print("   - Try hyperparameter tuning")
        print("   - Consider XGBoost as alternative")
        print("   - Backtest carefully before deployment")
    else:
        print("\n❌ FAILURE. Test accuracy <52%")
        print("   LSTM does not beat baseline.")
        print("   Recommendations:")
        print("   - Try XGBoost or Random Forest")
        print("   - Consider mean-reversion strategies")
        print("   - R_75 may not be predictable with technical features")

    print("\n✅ LSTM TRAINING COMPLETE!")
    print("=" * 70)

    return 0


if __name__ == '__main__':
    sys.exit(main())
