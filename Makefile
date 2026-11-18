# Régénération complète : make all
# Sans make (Windows) : python -m pipeline all, puis pnpm --dir web build et python -m docs.build_note.

PYTHON ?= python
PNPM ?= pnpm

.PHONY: all setup pipeline test lint web web-test check doc clean

all: pipeline test web web-test check doc

setup:
	$(PYTHON) -m pip install -r requirements.txt
	$(PNPM) --dir web install --frozen-lockfile

pipeline:
	$(PYTHON) -m pipeline all

test:
	$(PYTHON) -m pytest -q

lint:
	$(PYTHON) -m ruff check pipeline tests docs

web:
	$(PNPM) --dir web build

web-test:
	$(PNPM) --dir web test

# Rendu dans un navigateur sans interface : erreurs console et captures (outputs/screens).
check:
	$(PNPM) --dir web check

doc:
	$(PYTHON) -m docs.build_note

clean:
	$(PYTHON) -c "import shutil; [shutil.rmtree(p, ignore_errors=True) for p in ('outputs', 'web/dist')]"
