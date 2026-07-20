package sharding

import (
	"errors"
	"fmt"
	"hash/crc32"
)

var ErrBoardIDRequired = errors.New("boardId is required")

type Target struct {
	BoardID string
	ShardID string
	Index   int
}

type Router struct {
	shardIDs []string
}

func NewRouter(shardCount int) (*Router, error) {
	if shardCount < 1 {
		return nil, fmt.Errorf("shardCount must be at least 1")
	}

	shardIDs := make([]string, shardCount)
	for index := range shardIDs {
		shardIDs[index] = fmt.Sprintf("shard-%02d", index)
	}

	return &Router{shardIDs: shardIDs}, nil
}

func (r *Router) ShardIDs() []string {
	shardIDs := make([]string, len(r.shardIDs))
	copy(shardIDs, r.shardIDs)
	return shardIDs
}

func (r *Router) Resolve(boardID string) (Target, error) {
	if boardID == "" {
		return Target{}, ErrBoardIDRequired
	}

	shardIndex := int(crc32.ChecksumIEEE([]byte(boardID)) % uint32(len(r.shardIDs)))

	return Target{
		BoardID: boardID,
		ShardID: r.shardIDs[shardIndex],
		Index:   shardIndex,
	}, nil
}
