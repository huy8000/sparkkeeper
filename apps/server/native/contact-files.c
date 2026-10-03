#define _GNU_SOURCE
#include "safe-directory.h"
#include <stdio.h>
#include <stdlib.h>
#include <dirent.h>
#ifdef __linux__
#include <sys/syscall.h>
#include <linux/fs.h>
#endif
#ifdef __APPLE__
#include <sys/stdio.h>
#endif

static int safe_name(const char *s) {
  size_t n=strlen(s);if(n==0||n>160||s[0]=='.')return 0;
  for(size_t i=0;i<n;i++)if(!((s[i]>='a'&&s[i]<='z')||(s[i]>='0'&&s[i]<='9')||s[i]=='-'||s[i]=='_'||s[i]=='.'))return 0;
  return strstr(s,"..")==NULL;
}
int main(int argc,char **argv) {
  if(argc<3)return 64;
  const char *op=argv[1],*root=argv[2];
  int dir=anchored_directory(root,!strcmp(op,"init"));struct stat st;
  if(dir<0||fstat(dir,&st)||st.st_uid!=geteuid()||fchmod(dir,0700))return 65;
  if(!strcmp(op,"init")){int ok=same_directory(root,dir);close(dir);return ok?0:65;}
  if(!strcmp(op,"list")){
    DIR *d=fdopendir(dup(dir));if(!d)return 65;struct dirent *entry;int count=0;
    while((entry=readdir(d))!=NULL){if(entry->d_name[0]=='.')continue;if(!safe_name(entry->d_name)||++count>4096){closedir(d);return 65;}printf("%s\n",entry->d_name);}
    closedir(d);return same_directory(root,dir)?0:65;
  }
  if(argc!=4||!safe_name(argv[3]))return 64;
  const char *name=argv[3];
  if(!strcmp(op,"put")) {
    char temp[180];snprintf(temp,sizeof(temp),"pending-%ld-%.120s",(long)getpid(),name);
    int f=openat(dir,temp,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);if(f<0)return 65;
    char buffer[8192];ssize_t n;size_t total=0;int ok=1;
    while((n=read(STDIN_FILENO,buffer,sizeof(buffer)))>0){total+=(size_t)n;if(total>5242880){ok=0;break;}ssize_t off=0;while(off<n){ssize_t w=write(f,buffer+off,(size_t)(n-off));if(w<0){ok=0;break;}off+=w;}if(!ok)break;}
    if(n<0||total==0||fsync(f))ok=0;
    close(f);
    int result=-1;
    if(ok){
#ifdef __linux__
      result=(int)syscall(SYS_renameat2,dir,temp,dir,name,RENAME_NOREPLACE);
#elif defined(__APPLE__)
      result=renameatx_np(dir,temp,dir,name,RENAME_EXCL);
#else
      errno=ENOTSUP;
#endif
    }
    int saved=errno;unlinkat(dir,temp,0);
    if(!ok)return 65;
    if(result<0)return saved==EEXIST?66:65;
    if(fsync(dir)||!same_directory(root,dir))return 65;
    return 0;
  }
  int file=openat(dir,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);
  if(file<0)return errno==ENOENT?67:65;
  if(fstat(file,&st)||!S_ISREG(st.st_mode)||st.st_uid!=geteuid()||st.st_nlink!=1||st.st_size<=0||st.st_size>5242880||fchmod(file,0600))return 65;
  if(!strcmp(op,"stat")){if(!same_directory(root,dir))return 65;printf("%ld\n",(long)st.st_mtime);return 0;}
  if(!strcmp(op,"get")) {
    char buffer[8192];ssize_t n;
    while((n=read(file,buffer,sizeof(buffer)))>0){ssize_t off=0;while(off<n){ssize_t w=write(STDOUT_FILENO,buffer+off,(size_t)(n-off));if(w<=0)return 65;off+=w;}}
    if(n<0||!same_directory(root,dir))return 65;
    return 0;
  }
  if(!strcmp(op,"remove")) {
    struct stat current;if(fstatat(dir,name,&current,AT_SYMLINK_NOFOLLOW)||current.st_dev!=st.st_dev||current.st_ino!=st.st_ino)return 65;
    if(unlinkat(dir,name,0)||fsync(dir)||!same_directory(root,dir))return 65;
    return 0;
  }
  return 64;
}
