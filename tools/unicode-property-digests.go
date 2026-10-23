//go:build ignore

// Generates the complete source digests for tools/unicode-table.py.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

func main() {
	if err := generate(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func generate() error {
	input := bufio.NewReader(os.Stdin)
	output := bufio.NewWriter(os.Stdout)
	defer output.Flush()
	const limit = 0x110000
	const prime uint64 = 0x100000001b3
	prefixes := make([][7]byte, limit)
	const hex = "0123456789ABCDEF"
	for code := range prefixes {
		for digit := 0; digit < 6; digit++ {
			prefixes[code][digit] = hex[(code>>uint(4*(5-digit)))&15]
		}
		prefixes[code][6] = ':'
	}
	assignments := make([]byte, limit*2)
	for {
		line, err := input.ReadBytes('\n')
		if err == io.EOF && len(line) == 0 {
			return nil
		}
		if err != nil {
			return err
		}
		var header struct {
			Property string
			Tags     []string
		}
		if err := json.Unmarshal(line, &header); err != nil {
			return err
		}
		if _, err := io.ReadFull(input, assignments); err != nil {
			return err
		}
		var hash uint64 = 0xcbf29ce484222325
		for code := range prefixes {
			if code >= 0xd800 && code <= 0xdfff {
				continue
			}
			value := int(assignments[code*2]) | int(assignments[code*2+1])<<8
			if value >= len(header.Tags) {
				return fmt.Errorf("%s: an assignment has no tag list", header.Property)
			}
			for _, b := range prefixes[code] {
				hash = (hash ^ uint64(b)) * prime
			}
			for i := 0; i < len(header.Tags[value]); i++ {
				hash = (hash ^ uint64(header.Tags[value][i])) * prime
			}
			hash = (hash ^ '\n') * prime
		}
		if _, err := fmt.Fprintf(output, "%s %016x\n", header.Property, hash); err != nil {
			return err
		}
	}
}
