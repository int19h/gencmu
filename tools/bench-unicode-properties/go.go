//go:build ignore

// Public API worker for the Unicode property performance gate.
package main

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	gencmu "github.com/int19h/gencmu/lib/go"
)

func must[T any](value T, err error) T {
	if err != nil {
		panic(err)
	}
	return value
}
func decode(value string) string { return string(must(hex.DecodeString(value))) }
func rows(path string) [][]string {
	var result [][]string
	for _, line := range strings.Split(strings.TrimSuffix(string(must(os.ReadFile(path))), "\n"), "\n") {
		if line != "" {
			result = append(result, strings.Split(line, "\t"))
		}
	}
	return result
}
func names(value string) []string {
	if value == "" {
		return nil
	}
	return strings.Split(decode(value), "\n")
}
func main() {
	pipelines := map[string]*gencmu.Pipeline{}
	input := bufio.NewScanner(os.Stdin)
	for input.Scan() {
		fields := strings.Split(input.Text(), "\t")
		var answer any
		switch fields[0] {
		case "load":
			var pipeline *gencmu.Pipeline
			if fields[2] == "-" {
				pipeline = must(gencmu.LoadPipeline("lojban/cll"))
			} else {
				sources := map[string]string{}
				for _, row := range rows(fields[2]) {
					sources[decode(row[0])] = decode(row[1])
				}
				pipeline = must(gencmu.LoadPipelineSources(sources, "p.md"))
			}
			pipelines[fields[1]] = pipeline
			features := []any{}
			for _, f := range pipeline.Features() {
				features = append(features, []any{f.Name, f.Kind, f.Default})
			}
			answer = map[string]any{"features": features}
		case "batch":
			count := must(strconv.Atoi(fields[2]))
			cases := rows(fields[3])
			type item struct {
				text    string
				options gencmu.ParseOptions
			}
			items := []item{}
			for _, row := range cases {
				items = append(items, item{decode(row[1]), gencmu.ParseOptions{Features: names(row[2]), WithoutFeatures: names(row[3])}})
			}
			var results []*gencmu.ParseResult
			start := time.Now()
			for repeat := 0; repeat < count; repeat++ {
				results = nil
				for _, c := range items {
					results = append(results, must(pipelines[fields[1]].Parse(c.text, c.options)))
				}
			}
			seconds := time.Since(start).Seconds()
			start = time.Now()
			var output strings.Builder
			for _, result := range results {
				output.Write(must(json.Marshal(map[string]any{"result": json.RawMessage(must(gencmu.MarshalResult(result))), "brackets": gencmu.Brackets(result, gencmu.BracketOptions{})})))
				output.WriteByte('\n')
			}
			serialization := time.Since(start).Seconds()
			if fields[4] != "-" {
				if err := os.WriteFile(fields[4], []byte(output.String()), 0600); err != nil {
					panic(err)
				}
			}
			answer = map[string]any{"seconds": seconds, "serialization": serialization}
		case "concurrent":
			type table struct {
				name    string
				pipeline *gencmu.Pipeline
			}
			tables := []table{}
			for _, row := range rows(fields[2]) {
				sources := map[string]string{}
				for _, entry := range rows(row[1]) {
					sources[decode(entry[0])] = decode(entry[1])
				}
				tables = append(tables, table{row[0], must(gencmu.LoadPipelineSources(sources, "p.md"))})
			}
			results := make([]any, len(tables)*4)
			var group sync.WaitGroup
			for i := range results {
				group.Add(1)
				go func(i int) {
					defer group.Done()
					t := tables[i%len(tables)]
					a := must(t.pipeline.Parse("a", gencmu.ParseOptions{}))
					b := must(t.pipeline.Parse("b", gencmu.ParseOptions{}))
					results[i] = map[string]any{"name": t.name, "a": a.OK, "b": b.OK, "tags": b.Tree.Tags}
				}(i)
			}
			group.Wait()
			answer = results
		default:
			panic("Unknown command")
		}
		fmt.Println(string(must(json.Marshal(answer))))
	}
	if err := input.Err(); err != nil {
		panic(err)
	}
}
