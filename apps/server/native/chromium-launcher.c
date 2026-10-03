#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include "safe-directory.h"

static int discovery_proof(const char *path, const char *run_id, pid_t pid) {
#ifdef __linux__
  if (!run_id || strlen(run_id)!=36 || strspn(run_id,"0123456789abcdef-")!=36 || strlen(path)>=PATH_MAX) return -1;
  char parent[PATH_MAX];strcpy(parent,path);char *name=strrchr(parent,'/');if(!name)return -1;*name++=0;
  char expected[64];snprintf(expected,sizeof(expected),"%s.browser",run_id);if(strcmp(name,expected))return -1;
  int dir=anchored_directory(parent,0);if(dir<0)return -1;
  char stat[4096],boot[64];FILE *f=fopen("/proc/self/stat","r");if(!f)return -1;
  if(!fgets(stat,sizeof(stat),f)){fclose(f);return -1;}fclose(f);
  char *tail=strrchr(stat,')');if(!tail)return -1;tail+=2;
  char *save=NULL,*field=strtok_r(tail," ", &save),*start=NULL;
  for(int i=0;field;i++,field=strtok_r(NULL," ",&save))if(i==19){start=field;break;}
  if(!start||strspn(start,"0123456789")!=strlen(start))return -1;
  f=fopen("/proc/sys/kernel/random/boot_id","r");if(!f)return -1;
  if(!fgets(boot,sizeof(boot),f)){fclose(f);return -1;}fclose(f);boot[strcspn(boot,"\n")]=0;
  char proof[512];int n=snprintf(proof,sizeof(proof),"{\"runId\":\"%s\",\"pid\":%ld,\"pgid\":%ld,\"start\":\"%s\",\"boot\":\"%s\"}",run_id,(long)pid,(long)pid,start,boot);
  int fd=openat(dir,name,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
  if(fd<0||n<0||(size_t)n>=sizeof(proof))return -1;
  ssize_t result=write(fd,proof,(size_t)n);int ok=result==n&&fsync(fd)==0&&same_directory(parent,dir);close(fd);close(dir);return ok?0:-1;
#else
  (void)path;(void)run_id;(void)pid;return -1;
#endif
}

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
  const char *proof_path=getenv("SPARKKEEPER_DISCOVERY_PROOF_PATH");
  if(proof_path && discovery_proof(proof_path,getenv("SPARKKEEPER_DISCOVERY_RUN_ID"),pid)!=0) return 69;
  unsetenv("SPARKKEEPER_DISCOVERY_PROOF_PATH");
  unsetenv("SPARKKEEPER_DISCOVERY_RUN_ID");
  argv[0] = (char *)real_executable;
  execv(real_executable, argv);
  unlink(identity_file);
  return 68;
}
