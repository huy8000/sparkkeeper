#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static int write_all(int fd, const char *buffer, size_t length) {
  size_t written = 0;
  while (written < length) {
    ssize_t result = write(fd, buffer + written, length - written);
    if (result < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    written += (size_t)result;
  }
  return 0;
}

int main(int argc, char **argv) {
  const char *real_executable = getenv("SPARKKEEPER_CHROMIUM_EXECUTABLE");
  const char *identity_file = getenv("SPARKKEEPER_CHROMIUM_IDENTITY_FILE");
  if (argc < 1 || real_executable == NULL || real_executable[0] != '/' ||
      identity_file == NULL || identity_file[0] != '/') {
    return 64;
  }

  pid_t pid = getpid();
  pid_t pgid = getpgrp();
  if (pid <= 1 || pgid != pid) return 65;

  int fd = open(identity_file, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (fd < 0) return 66;
  char identity[96];
  int length = snprintf(identity, sizeof(identity), "%ld %ld\n", (long)pid, (long)pgid);
  if (length <= 0 || (size_t)length >= sizeof(identity) ||
      write_all(fd, identity, (size_t)length) != 0 || fsync(fd) != 0 || close(fd) != 0) {
    unlink(identity_file);
    return 67;
  }

  unsetenv("SPARKKEEPER_CHROMIUM_EXECUTABLE");
  unsetenv("SPARKKEEPER_CHROMIUM_IDENTITY_FILE");
  argv[0] = (char *)real_executable;
  execv(real_executable, argv);
  unlink(identity_file);
  return 68;
}
