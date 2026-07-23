package ws

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"
)

type Relay interface {
	Subscribe(ctx context.Context, boardID string) (<-chan Op, func(), error)
	Publish(ctx context.Context, op Op) error
	Close() error
}

type RedisRelay struct {
	client *redis.Client
	prefix string
	nodeID string
}

type relayEnvelope struct {
	Origin string `json:"origin"`
	Op     Op     `json:"op"`
}

func NewRedisRelay(redisURL, prefix, nodeID string) (*RedisRelay, error) {
	if redisURL == "" {
		return nil, fmt.Errorf("redis url is required")
	}

	client := redis.NewClient(&redis.Options{Addr: redisURL})
	return &RedisRelay{
		client: client,
		prefix: prefix,
		nodeID: nodeID,
	}, nil
}

func (r *RedisRelay) Subscribe(ctx context.Context, boardID string) (<-chan Op, func(), error) {
	pubSub := r.client.Subscribe(ctx, r.channel(boardID))
	out := make(chan Op, 16)

	go func() {
		defer close(out)

		channel := pubSub.Channel()
		for message := range channel {
			var envelope relayEnvelope
			if err := json.Unmarshal([]byte(message.Payload), &envelope); err != nil {
				continue
			}

			if envelope.Origin == r.nodeID {
				continue
			}

			out <- envelope.Op
		}
	}()

	return out, func() {
		_ = pubSub.Close()
	}, nil
}

func (r *RedisRelay) Publish(ctx context.Context, op Op) error {
	payload, err := json.Marshal(relayEnvelope{
		Origin: r.nodeID,
		Op:     op,
	})
	if err != nil {
		return fmt.Errorf("marshal relay payload: %w", err)
	}

	if err := r.client.Publish(ctx, r.channel(op.BoardID), payload).Err(); err != nil {
		return fmt.Errorf("publish relay payload: %w", err)
	}

	return nil
}

func (r *RedisRelay) Close() error {
	return r.client.Close()
}

func (r *RedisRelay) channel(boardID string) string {
	if r.prefix == "" {
		return boardID
	}

	return r.prefix + ":" + boardID
}
