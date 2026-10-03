#define _GNU_SOURCE

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/file.h>
#include <unistd.h>

#if defined(__linux__)
#ifndef RENAME_NOREPLACE
#define RENAME_NOREPLACE (1 << 0)
#endif
#endif

#define MARKER_FILE ".sparkkeeper-profile.json"
#define RESULT_EXISTS 2
#define RESULT_UNSUPPORTED 3
#define RESULT_ERROR 4
#define RESULT_NOT_EMPTY 5
#define RESULT_UNSAFE 6
#define RESULT_OWNERSHIP 7
#define RESULT_MISSING 8
#define RESULT_CROSS_DEVICE 9

static int valid_name(const char *value) {
  return value != NULL && value[0] != '\0' && strlen(value) <= NAME_MAX &&
         strcmp(value, ".") != 0 && strcmp(value, "..") != 0 && strchr(value, '/') == NULL;
}

static int valid_uuid(const char *value) {
  if (value == NULL || strlen(value) != 36) return 0;
  for (size_t index = 0; index < 36; ++index) {
    char character = value[index];
    if (index == 8 || index == 13 || index == 18 || index == 23) {
      if (character != '-') return 0;
    } else if (!((character >= '0' && character <= '9') ||
                 (character >= 'a' && character <= 'f'))) {
      return 0;
    }
  }
  return 1;
}

static int open_absolute_directory(const char *directory) {
  if (directory == NULL || directory[0] != '/') {
    errno = EINVAL;
    return -1;
  }
  char *copy = strdup(directory);
  if (copy == NULL) return -1;
  int descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) {
    free(copy);
    return -1;
  }

  char *state = NULL;
  for (char *segment = strtok_r(copy, "/", &state); segment != NULL;
       segment = strtok_r(NULL, "/", &state)) {
    if (!valid_name(segment)) {
      close(descriptor);
      free(copy);
      errno = EINVAL;
      return -1;
    }
    int next = openat(descriptor, segment, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (next < 0) {
      close(descriptor);
      free(copy);
      return -1;
    }
    close(descriptor);
    descriptor = next;
  }
  free(copy);
  return descriptor;
}

static int expected_marker(char *buffer, size_t size, const char *account_id,
                           const char *session_id) {
  if (!valid_uuid(account_id) || !valid_uuid(session_id)) return -1;
  int length = snprintf(buffer, size,
                        "{\"version\":1,\"accountId\":\"%s\","
                        "\"createdByLoginSessionId\":\"%s\"}\n",
                        account_id, session_id);
  return length > 0 && (size_t)length < size ? length : -1;
}

static int write_all(int descriptor, const char *buffer, size_t length) {
  size_t written = 0;
  while (written < length) {
    ssize_t result = write(descriptor, buffer + written, length - written);
    if (result < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    written += (size_t)result;
  }
  return 0;
}

static int validate_marker(int profile_fd, const char *account_id, const char *session_id) {
  char expected[256];
  int expected_length = expected_marker(expected, sizeof(expected), account_id, session_id);
  if (expected_length < 0) return RESULT_OWNERSHIP;
  int marker_fd = openat(profile_fd, MARKER_FILE, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (marker_fd < 0) return errno == ENOENT ? RESULT_OWNERSHIP : RESULT_UNSAFE;
  struct stat marker_state;
  if (fstat(marker_fd, &marker_state) != 0 || !S_ISREG(marker_state.st_mode) ||
      marker_state.st_size != expected_length || fchmod(marker_fd, 0600) != 0) {
    close(marker_fd);
    return RESULT_OWNERSHIP;
  }
  char actual[256];
  ssize_t length = read(marker_fd, actual, sizeof(actual));
  close(marker_fd);
  if (length != expected_length || memcmp(actual, expected, (size_t)expected_length) != 0) {
    return RESULT_OWNERSHIP;
  }
  return 0;
}

static int open_owned_profile(int parent_fd, const char *name, const char *account_id,
                              const char *session_id, struct stat *profile_state) {
  int profile_fd = openat(parent_fd, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (profile_fd < 0) return errno == ENOENT ? -RESULT_MISSING : -RESULT_UNSAFE;
  if (fstat(profile_fd, profile_state) != 0 || !S_ISDIR(profile_state->st_mode) ||
      fchmod(profile_fd, 0700) != 0) {
    close(profile_fd);
    return -RESULT_UNSAFE;
  }
  int marker_result = validate_marker(profile_fd, account_id, session_id);
  if (marker_result != 0) {
    close(profile_fd);
    return -marker_result;
  }
  return profile_fd;
}

static int create_profile(const char *parent, const char *name, const char *account_id,
                          const char *session_id) {
  if (!valid_name(name)) return RESULT_UNSAFE;
  int parent_fd = open_absolute_directory(parent);
  if (parent_fd < 0) return RESULT_UNSAFE;
  if (mkdirat(parent_fd, name, 0700) != 0) {
    int result = errno == EEXIST ? RESULT_EXISTS : RESULT_ERROR;
    close(parent_fd);
    return result;
  }
  int profile_fd = openat(parent_fd, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (profile_fd < 0) {
    unlinkat(parent_fd, name, AT_REMOVEDIR);
    close(parent_fd);
    return RESULT_UNSAFE;
  }
  char marker[256];
  int marker_length = expected_marker(marker, sizeof(marker), account_id, session_id);
  int marker_fd = marker_length < 0
                      ? -1
                      : openat(profile_fd, MARKER_FILE,
                               O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  int result = marker_fd < 0 ? RESULT_ERROR : 0;
  if (result == 0 &&
      (fchmod(profile_fd, 0700) != 0 ||
       write_all(marker_fd, marker, (size_t)marker_length) != 0 || fsync(marker_fd) != 0)) {
    result = RESULT_ERROR;
  }
  if (marker_fd >= 0) {
    if (close(marker_fd) != 0) result = RESULT_ERROR;
    marker_fd = -1;
  }
  if (result == 0 && fsync(profile_fd) != 0) result = RESULT_ERROR;
  if (result == 0) {
    result = validate_marker(profile_fd, account_id, session_id);
  }
  if (result != 0) {
    unlinkat(profile_fd, MARKER_FILE, 0);
    close(profile_fd);
    unlinkat(parent_fd, name, AT_REMOVEDIR);
    close(parent_fd);
    return result;
  }
  close(profile_fd);
  fsync(parent_fd);
  close(parent_fd);
  return 0;
}

static int rename_no_replace(int source_parent, const char *source_name, int destination_parent,
                             const char *destination_name) {
#if defined(__linux__) && defined(SYS_renameat2)
  if (syscall(SYS_renameat2, source_parent, source_name, destination_parent, destination_name,
              RENAME_NOREPLACE) == 0) {
    return 0;
  }
  if (errno == EEXIST || errno == ENOTEMPTY) return RESULT_EXISTS;
  if (errno == EXDEV) return RESULT_CROSS_DEVICE;
  if (errno == ENOSYS || errno == EINVAL || errno == EOPNOTSUPP) return RESULT_UNSUPPORTED;
  return RESULT_ERROR;
#elif defined(__APPLE__)
  if (renameatx_np(source_parent, source_name, destination_parent, destination_name, RENAME_EXCL) ==
      0) {
    return 0;
  }
  if (errno == EEXIST || errno == ENOTEMPTY) return RESULT_EXISTS;
  if (errno == EXDEV) return RESULT_CROSS_DEVICE;
  if (errno == ENOTSUP || errno == EINVAL) return RESULT_UNSUPPORTED;
  return RESULT_ERROR;
#else
  (void)source_parent;
  (void)source_name;
  (void)destination_parent;
  (void)destination_name;
  return RESULT_UNSUPPORTED;
#endif
}

static int rename_profile(const char *source_parent, const char *source_name,
                          const char *destination_parent, const char *destination_name,
                          const char *account_id, const char *session_id) {
  if (!valid_name(source_name) || !valid_name(destination_name)) return RESULT_UNSAFE;
  int source_parent_fd = open_absolute_directory(source_parent);
  int destination_parent_fd = open_absolute_directory(destination_parent);
  if (source_parent_fd < 0 || destination_parent_fd < 0) {
    if (source_parent_fd >= 0) close(source_parent_fd);
    if (destination_parent_fd >= 0) close(destination_parent_fd);
    return RESULT_UNSAFE;
  }
  struct stat source_parent_state;
  struct stat destination_parent_state;
  if (fstat(source_parent_fd, &source_parent_state) != 0 ||
      fstat(destination_parent_fd, &destination_parent_state) != 0) {
    close(source_parent_fd);
    close(destination_parent_fd);
    return RESULT_ERROR;
  }
  if (source_parent_state.st_dev != destination_parent_state.st_dev) {
    close(source_parent_fd);
    close(destination_parent_fd);
    return RESULT_CROSS_DEVICE;
  }

  struct stat source_state;
  int source_fd = open_owned_profile(source_parent_fd, source_name, account_id, session_id,
                                     &source_state);
  if (source_fd < 0) {
    close(source_parent_fd);
    close(destination_parent_fd);
    return -source_fd;
  }
  struct stat source_entry_state;
  if (fstatat(source_parent_fd, source_name, &source_entry_state, AT_SYMLINK_NOFOLLOW) != 0 ||
      source_entry_state.st_dev != source_state.st_dev ||
      source_entry_state.st_ino != source_state.st_ino) {
    close(source_fd);
    close(source_parent_fd);
    close(destination_parent_fd);
    return RESULT_UNSAFE;
  }

  int result = rename_no_replace(source_parent_fd, source_name, destination_parent_fd,
                                 destination_name);
  if (result == 0) {
    struct stat destination_state;
    int destination_fd = open_owned_profile(destination_parent_fd, destination_name, account_id,
                                            session_id, &destination_state);
    if (destination_fd < 0 || destination_state.st_dev != source_state.st_dev ||
        destination_state.st_ino != source_state.st_ino) {
      result = destination_fd < 0 ? -destination_fd : RESULT_UNSAFE;
    }
    if (destination_fd >= 0) close(destination_fd);
    struct stat unexpected_source;
    if (result == 0 &&
        (fstatat(source_parent_fd, source_name, &unexpected_source, AT_SYMLINK_NOFOLLOW) == 0 ||
         errno != ENOENT)) {
      result = RESULT_UNSAFE;
    }
  }
  close(source_fd);
  fsync(source_parent_fd);
  fsync(destination_parent_fd);
  close(source_parent_fd);
  close(destination_parent_fd);
  return result;
}

static int remove_empty_profile(const char *parent, const char *name, const char *account_id,
                                const char *session_id) {
  if (!valid_name(name)) return RESULT_UNSAFE;
  int parent_fd = open_absolute_directory(parent);
  if (parent_fd < 0) return RESULT_UNSAFE;
  struct stat profile_state;
  int profile_fd = open_owned_profile(parent_fd, name, account_id, session_id, &profile_state);
  if (profile_fd < 0) {
    close(parent_fd);
    return -profile_fd;
  }
  struct stat entry_state;
  if (fstatat(parent_fd, name, &entry_state, AT_SYMLINK_NOFOLLOW) != 0 ||
      entry_state.st_dev != profile_state.st_dev || entry_state.st_ino != profile_state.st_ino) {
    close(profile_fd);
    close(parent_fd);
    return RESULT_UNSAFE;
  }

  DIR *directory = fdopendir(dup(profile_fd));
  if (directory == NULL) {
    close(profile_fd);
    close(parent_fd);
    return RESULT_ERROR;
  }
  int result = 0;
  errno = 0;
  for (struct dirent *entry = readdir(directory); entry != NULL; entry = readdir(directory)) {
    if (strcmp(entry->d_name, ".") != 0 && strcmp(entry->d_name, "..") != 0 &&
        strcmp(entry->d_name, MARKER_FILE) != 0) {
      result = RESULT_NOT_EMPTY;
      break;
    }
  }
  if (result == 0 && errno != 0) result = RESULT_ERROR;
  closedir(directory);
  if (result == 0 && unlinkat(profile_fd, MARKER_FILE, 0) != 0) result = RESULT_ERROR;
  if (result == 0 && fsync(profile_fd) != 0) result = RESULT_ERROR;
  close(profile_fd);
  if (result == 0 && unlinkat(parent_fd, name, AT_REMOVEDIR) != 0) result = RESULT_ERROR;
  if (result == 0) {
    struct stat unexpected;
    if (fstatat(parent_fd, name, &unexpected, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT) {
      result = RESULT_UNSAFE;
    }
  }
  fsync(parent_fd);
  close(parent_fd);
  return result;
}

/* Offline operator entry: shares the exact lock used by app/maintenance Docker
 * entrypoints. The descriptor survives exec; it is never unlinked on failure. */
static int offline_lock(const char *root, char **command) {
  int root_fd = open_absolute_directory(root);
  if (root_fd < 0) return RESULT_UNSAFE;
  int lock_fd = openat(root_fd, "browser-profile.lock", O_RDWR | O_CREAT | O_NOFOLLOW, 0600);
  close(root_fd);
  struct stat state;
  if (lock_fd < 0 || fstat(lock_fd, &state) != 0 || !S_ISREG(state.st_mode) ||
      state.st_nlink != 1 || fchmod(lock_fd, 0600) != 0 || flock(lock_fd, LOCK_EX | LOCK_NB) != 0)
    return RESULT_UNSAFE;
  char descriptor[32];
  snprintf(descriptor, sizeof(descriptor), "%d", lock_fd);
  if (setenv("SPARKKEEPER_OFFLINE_LOCK_FD", descriptor, 1) != 0) return RESULT_ERROR;
  execvp(command[0], command);
  return RESULT_ERROR;
}

static int bind_legacy(const char *root, const char *account_id, const char *operation_id,
                       const char *device, const char *inode, int verify_only) {
  if (!valid_uuid(account_id) || !valid_uuid(operation_id) || !device[0] || !inode[0]) return RESULT_UNSAFE;
  char *end_device, *end_inode;
  unsigned long long expected_device = strtoull(device, &end_device, 10);
  unsigned long long expected_inode = strtoull(inode, &end_inode, 10);
  if (*end_device || *end_inode) return RESULT_UNSAFE;
  int root_fd = open_absolute_directory(root);
  if (root_fd < 0) return RESULT_UNSAFE;
  if (!verify_only && mkdirat(root_fd, "browser-profiles", 0700) != 0 && errno != EEXIST) { close(root_fd); return RESULT_ERROR; }
  int destination_parent = openat(root_fd, "browser-profiles", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (destination_parent < 0 || fchmod(destination_parent, 0700) != 0) { close(root_fd); if(destination_parent>=0)close(destination_parent); return RESULT_UNSAFE; }
  int source_fd = -1;
  int result = 0;
  struct stat source_state, entry;
  if (!verify_only) {
  source_fd = openat(root_fd, "browser-profile", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (source_fd < 0 && errno == ENOENT) {
    source_fd = open_owned_profile(destination_parent, account_id, account_id, operation_id, &source_state);
    if (source_fd < 0) result = -source_fd;
  } else if(source_fd < 0) result = RESULT_UNSAFE;
  else {
    if (fstat(source_fd, &source_state) != 0 || fchmod(source_fd, 0700) != 0) result=RESULT_UNSAFE;
    if(result==0 && ((unsigned long long)source_state.st_dev!=expected_device || (unsigned long long)source_state.st_ino!=expected_inode)) result=RESULT_OWNERSHIP;
    if(result==0 && (fstatat(source_fd,"SingletonLock",&entry,AT_SYMLINK_NOFOLLOW)==0 || errno!=ENOENT)) result=RESULT_UNSAFE;
    if(result==0) {
      char marker[256]; int length=expected_marker(marker,sizeof(marker),account_id,operation_id);
      int marker_fd=openat(source_fd,MARKER_FILE,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
      if(marker_fd>=0) {
        if(length<0 || write_all(marker_fd,marker,(size_t)length)!=0 || fsync(marker_fd)!=0)result=RESULT_ERROR;
        close(marker_fd);
      } else if(errno!=EEXIST) result=RESULT_UNSAFE;
      if(result==0)result=validate_marker(source_fd,account_id,operation_id);
      if(result==0 && fsync(source_fd)!=0)result=RESULT_ERROR;
    }
    if(result==0 && (fstatat(root_fd,"browser-profile",&entry,AT_SYMLINK_NOFOLLOW)!=0 || entry.st_dev!=source_state.st_dev || entry.st_ino!=source_state.st_ino))result=RESULT_UNSAFE;
    if(result==0)result=rename_no_replace(root_fd,"browser-profile",destination_parent,account_id);
    if(result==0 && (fsync(root_fd)!=0 || fsync(destination_parent)!=0))result=RESULT_ERROR;
    if(result==0 && (fstatat(root_fd,"browser-profile",&entry,AT_SYMLINK_NOFOLLOW)==0 || errno!=ENOENT))result=RESULT_UNSAFE;
  }
  }
  if(result==0) {
    struct stat final_state;
    int final_fd=open_owned_profile(destination_parent,account_id,account_id,operation_id,&final_state);
    if(final_fd<0)result=-final_fd;
    else {
      if((unsigned long long)final_state.st_dev!=expected_device || (unsigned long long)final_state.st_ino!=expected_inode) result=RESULT_OWNERSHIP;
      if(result==0 && (fstatat(destination_parent,account_id,&entry,AT_SYMLINK_NOFOLLOW)!=0 || entry.st_dev!=final_state.st_dev || entry.st_ino!=final_state.st_ino)) result=RESULT_UNSAFE;
      if(result==0) result=validate_marker(final_fd,account_id,operation_id);
      close(final_fd);
    }
  }
  if(source_fd>=0)close(source_fd);
  close(destination_parent);close(root_fd);return result;
}

int main(int argc, char **argv) {
  if(argc>=5 && strcmp(argv[1],"offline-lock")==0) return offline_lock(argv[2],&argv[3]);
  if(argc==7 && strcmp(argv[1],"bind-legacy")==0) return bind_legacy(argv[2],argv[3],argv[4],argv[5],argv[6],0);
  if(argc==7 && strcmp(argv[1],"verify-legacy-binding")==0) return bind_legacy(argv[2],argv[3],argv[4],argv[5],argv[6],1);
  if (argc == 6 && strcmp(argv[1], "create") == 0) {
    return create_profile(argv[2], argv[3], argv[4], argv[5]);
  }
  if (argc == 8 && strcmp(argv[1], "rename") == 0) {
    return rename_profile(argv[2], argv[3], argv[4], argv[5], argv[6], argv[7]);
  }
  if (argc == 6 && strcmp(argv[1], "remove-empty") == 0) {
    return remove_empty_profile(argv[2], argv[3], argv[4], argv[5]);
  }
  return RESULT_ERROR;
}
