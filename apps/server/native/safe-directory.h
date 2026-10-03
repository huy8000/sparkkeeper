#ifndef SPARKKEEPER_SAFE_DIRECTORY_H
#define SPARKKEEPER_SAFE_DIRECTORY_H
#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <sys/stat.h>
#include <errno.h>
#include <limits.h>

/* Walk from / using dirfds, never following a symlink, including ancestors. */
static int anchored_directory(const char *path, int create_leaf) {
  if (!path || path[0]!='/' || strlen(path)>=PATH_MAX) {errno=EINVAL;return -1;}
  char copy[PATH_MAX];strcpy(copy,path);
  int fd=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  char *save=NULL,*part=strtok_r(copy+1,"/",&save);
  if (!part) {close(fd);errno=EINVAL;return -1;}
  while(part && fd>=0) {
    char *next=strtok_r(NULL,"/",&save);
    if(!strcmp(part,".")||!strcmp(part,"..")){close(fd);errno=EINVAL;return -1;}
    if(!next&&create_leaf&&mkdirat(fd,part,0700)<0&&errno!=EEXIST){close(fd);return -1;}
    int child=openat(fd,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    close(fd);fd=child;part=next;
  }
  return fd;
}
static inline int same_directory(const char *path,int fd) {
  int current=anchored_directory(path,0);struct stat a,b;
  int ok=current>=0&&fstat(fd,&a)==0&&fstat(current,&b)==0&&a.st_dev==b.st_dev&&a.st_ino==b.st_ino;
  if(current>=0)close(current);
  return ok;
}
#endif
