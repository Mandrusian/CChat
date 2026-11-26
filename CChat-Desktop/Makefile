CC ?= clang
CFLAGS ?= -std=c11 -Wall -Wextra -Werror -O2
RAYLIB_FLAGS ?= $(shell pkg-config --cflags --libs raylib 2>/dev/null)
CURL_FLAGS ?= -lcurl

ifeq ($(shell uname -s),Darwin)
MACOS_FRAMEWORKS = -framework CoreVideo -framework IOKit -framework Cocoa -framework GLUT -framework OpenGL
endif

cchat-desktop: main.c
	$(CC) $(CFLAGS) main.c -o cchat-desktop $(RAYLIB_FLAGS) $(CURL_FLAGS) $(MACOS_FRAMEWORKS)

clean:
	rm -f cchat-desktop
