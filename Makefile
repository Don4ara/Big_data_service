.PHONY: dump-help dump-prepare dump-start dump-up dump-import dump-stop dump-down dump-reset dump-logs dump-ps dump-clean

DUMP_TS = npx ts-node --transpile-only dump-loader/dump-loader.ts

dump-help:
	$(DUMP_TS) help

dump-prepare:
	$(DUMP_TS) prepare

dump-start:
	$(DUMP_TS) start

dump-up:
	$(DUMP_TS) up

dump-import:
	$(DUMP_TS) import

dump-stop:
	$(DUMP_TS) stop

dump-down:
	$(DUMP_TS) down

dump-reset:
	$(DUMP_TS) reset

dump-logs:
	$(DUMP_TS) logs

dump-ps:
	$(DUMP_TS) ps

dump-clean:
	$(DUMP_TS) clean
