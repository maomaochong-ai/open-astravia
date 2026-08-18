package logger

import (
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Config controls logger output.
type Config struct {
	// Level is one of "debug", "info", "warn", "error". Empty defaults to "info".
	Level string

	// File is an optional log file path. Empty means stderr-only.
	File string
}

// New constructs a *zap.Logger that writes to stderr (always) and,
// optionally, also to a file. The file's parent directory is created if
// missing. Returns a no-op logger paired with an error if the file cannot
// be opened — callers should treat that as a startup failure.
func New(cfg Config) (*zap.Logger, error) {
	level, err := parseLevel(cfg.Level)
	if err != nil {
		return zap.NewNop(), err
	}

	encoderCfg := zapcore.EncoderConfig{
		TimeKey:        "t",
		LevelKey:       "l",
		NameKey:        "n",
		CallerKey:      "c",
		MessageKey:     "msg",
		StacktraceKey:  "stack",
		LineEnding:     zapcore.DefaultLineEnding,
		EncodeLevel:    zapcore.LowercaseLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.SecondsDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	}
	consoleEnc := zapcore.NewConsoleEncoder(encoderCfg)

	cores := []zapcore.Core{
		zapcore.NewCore(consoleEnc, zapcore.AddSync(os.Stderr), level),
	}

	if cfg.File != "" {
		if err := os.MkdirAll(filepath.Dir(cfg.File), 0o700); err != nil {
			return zap.NewNop(), fmt.Errorf("create log dir: %w", err)
		}
		f, err := os.OpenFile(cfg.File, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return zap.NewNop(), fmt.Errorf("open log file: %w", err)
		}
		jsonEnc := zapcore.NewJSONEncoder(encoderCfg)
		cores = append(cores, zapcore.NewCore(jsonEnc, zapcore.AddSync(f), level))
	}

	return zap.New(zapcore.NewTee(cores...), zap.AddCaller()), nil
}

func parseLevel(s string) (zapcore.Level, error) {
	switch s {
	case "", "info":
		return zapcore.InfoLevel, nil
	case "debug":
		return zapcore.DebugLevel, nil
	case "warn":
		return zapcore.WarnLevel, nil
	case "error":
		return zapcore.ErrorLevel, nil
	default:
		return zapcore.InfoLevel, fmt.Errorf("logger: unknown level %q", s)
	}
}
