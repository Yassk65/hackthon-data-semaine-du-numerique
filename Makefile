# Régénération complète : make all
# Sous Windows sans make : python -m pipeline all (même résultat), puis npm --prefix web run build.

PYTHON ?= python
NPM ?= npm

.PHONY: all setup pipeline test lint web web-test doc clean

all: pipeline test web doc

setup:
	$(PYTHON) -m pip install -r requirements.txt
	$(NPM) --prefix web ci

pipeline:
	$(PYTHON) -m pipeline all

test:
	$(PYTHON) -m pytest -q

lint:
	$(PYTHON) -m ruff check pipeline tests

web:
	$(NPM) --prefix web run build

web-test:
	$(NPM) --prefix web test

doc:
	$(PYTHON) -m docs.build_note

clean:
	$(PYTHON) -c "import shutil; [shutil.rmtree(p, ignore_errors=True) for p in ('outputs', 'web/dist')]"
