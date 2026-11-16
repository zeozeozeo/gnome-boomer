UUID = boomer@digital
DATA_DIR = $(if $(XDG_DATA_HOME),$(XDG_DATA_HOME),$(HOME)/.local/share)
EXTENSION_DIR = $(DATA_DIR)/gnome-shell/extensions/$(UUID)
SOURCES = metadata.json extension.js prefs.js README.md LICENSE

.PHONY: all schemas install pack clean

all: schemas

schemas:
	glib-compile-schemas --strict schemas

install: schemas
	mkdir -p "$(EXTENSION_DIR)"
	cp $(SOURCES) "$(EXTENSION_DIR)/"
	rm -rf "$(EXTENSION_DIR)/schemas"
	cp -r schemas "$(EXTENSION_DIR)/"
	@echo "Installed $(UUID) in $(EXTENSION_DIR)"

pack: schemas
	gnome-extensions pack --force \
		--extra-source=README.md \
		--extra-source=LICENSE \
		--out-dir=. \
		.
	@echo "Created $(UUID).shell-extension.zip"

clean:
	rm -f schemas/gschemas.compiled
	rm -f $(UUID).shell-extension.zip
